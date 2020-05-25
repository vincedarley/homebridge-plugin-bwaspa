import * as crc from "crc";
import type { Logger } from 'homebridge';
import * as net from "net";

export const PUMP_NOT_EXISTS = "-";
export const PUMP_OFF = "Off";
export const PUMP_LOW = "Low";
export const PUMP_HIGH = "High";
export const PUMP_STATES = [PUMP_OFF, PUMP_LOW, PUMP_HIGH];
export const FLOW_GOOD = "Good";
export const FLOW_LOW = "Low";
export const FLOW_FAILED = "Failed";
export const FLOW_STATES = [FLOW_GOOD, FLOW_LOW, FLOW_FAILED];

const PrimaryRequest = new Uint8Array([0x0a, 0xbf, 0x22]);
const GetFaultsMessageContents = new Uint8Array([0x20, 0xff, 0x00]);
const GetFaultsReply = new Uint8Array([0x0a,0xbf,0x28]);
// These will tell us how many pumps, lights, etc the Spa has
const ControlTypesMessageContents = new Uint8Array([0x00, 0x00, 0x01]);
const ControlTypesReply = new Uint8Array([0x0a,0xbf,0x2e]);

// This one is sent to us automatically every second - no need to request it
const StateReply = new Uint8Array([0xff,0xaf,0x13]);
// These two either don't have a reply or we don't care about it.
const ToggleItemRequest = new Uint8Array([0x0a, 0xbf, 0x11]);
const SetTargetTempRequest = new Uint8Array([0x0a, 0xbf, 0x20]);
// These we send once, but don't actually currently make use of the results
// Need to investigate how to interpret them. 
const ConfigRequest = new Uint8Array([0x0a, 0xbf, 0x04]);
const ConfigReply = new Uint8Array([0x0a,0xbf,0x94]);

// Four different request message contents and their reply codes. Unclear of the 
// purpose/value of all of them yet. Again we send each once.
const ControlPanelRequest : Uint8Array[][] = [
    [new Uint8Array([0x01,0x00,0x00]), new Uint8Array([0x0a,0xbf,0x23])],
    [new Uint8Array([0x02,0x00,0x00]), new Uint8Array([0x0a,0xbf,0x24])],
    [new Uint8Array([0x04,0x00,0x00]), new Uint8Array([0x0a,0xbf,0x25])],
    [new Uint8Array([0x08,0x00,0x00]), new Uint8Array([0x0a,0xbf,0x26])]
];

export class SpaClient {
    socket?: net.Socket;
    // undefined means the light doesn't exist on the spa
    lightIsOn: (boolean | undefined)[];
    // takes values from PUMP_STATES or PUMP_NOT_EXISTS
    pumpsCurrentSpeed: string[];
    // 0 means doesn't exist, else 1 or 2 indicates number of speeds for this pump
    pumpsSpeedRange: number[];

    currentTemp?: number;
    // When spa is in 'high' mode, what is the target temperature
    targetTempModeHigh: number;
    // When spa is in 'low' mode, what is the target temperature
    targetTempModeLow: number;
    // Is spa in low or high mode.
    tempRangeIsHigh: boolean;
    // Time of day, according to the Spa (sync it with the Balboa mobile app if you wish)
    hour: number;
    minute: number;
    // ready, ready at rest, etc.
    heatingMode: string;
    temp_CorF: string;
    priming: boolean;
    time_12or24: string;
    isHeatingNow: boolean;
    circulationPumpIsOn: boolean;
    // Takes values from FLOW_STATES
    flow: string;
    // Once the Spa has told us what accessories it really has. Only need to do this once.
    accurateConfigReadFromSpa: boolean;
    // Should be true for almost all of the time, but occasionally the Spa's connection drops
    // and we must reconnect.
    private isCurrentlyConnectedToSpa: boolean;
    // Don't use the automatically determined configuration to constrain the actions taken.
    ignoreAutomaticConfiguration: boolean;
    // Stored so that we can cancel it if needed
    faultCheckIntervalId: any;

    lastStateBytes = new Uint8Array();
    lastFaultBytes = new Uint8Array();

    constructor(public readonly log: Logger, public readonly host: string, 
      public readonly changesCallback: () => void, ignoreAutomatic?: boolean) {
        this.accurateConfigReadFromSpa = false;
        this.isCurrentlyConnectedToSpa = false;
        this.ignoreAutomaticConfiguration = (ignoreAutomatic ? ignoreAutomatic : false);
        // Be generous to start. Once we've read the config we will reduce the number of lights
        // if needed.
        this.lightIsOn = [false,false];
        // Be generous to start.  Once we've read the config, we'll set reduce
        // the number of pumps and their number of speeds correctly
        this.pumpsCurrentSpeed = [PUMP_OFF,PUMP_OFF,PUMP_OFF,PUMP_OFF,PUMP_OFF,PUMP_OFF];
        this.pumpsSpeedRange = [2,2,2,2,2,2];
        // All of these will be set by the Spa as soon as we get the first status update
        this.currentTemp = undefined;
        this.hour = 12;
        this.minute = 0;
        this.heatingMode = "";
        this.temp_CorF = "";
        this.tempRangeIsHigh = true;
        this.targetTempModeLow = 2*18;
        this.targetTempModeHigh = 2*38;
        this.priming = false;
        this.time_12or24 = "12 Hr";
        this.isHeatingNow = false;
        this.circulationPumpIsOn = false;
        // This isn't updated as frequently as the above
        this.flow = FLOW_GOOD;
        // Our communications channel with the spa
        this.socket = this.get_socket(host);
    }

    get_socket(host: string) {
        if (this.isCurrentlyConnectedToSpa) {
            this.log.error("Already connected, should not be trying again.");
        }

        this.log.debug("Connecting to Spa at", host, "on port 4257");
        this.socket = net.connect({
            port: 4257, 
            host: host
        }, () => {
            this.log.info('Successfully connected to Spa at', host, "on port 4257");
            this.successfullyConnectedToSpa();
        });
        this.socket?.on('end', () => {
            this.log.debug("SpaClient: disconnected:");
        });
        // If we get an error, then retry
        this.socket?.on('error', (error: any) => {
            this.log.debug(error);
            this.log.info("Had error - closing old socket, retrying in 20s");
            
            this.shutdownSpaConnection();
            this.reconnect(host);
        });
        
        return this.socket;
    }

    successfullyConnectedToSpa() {
        this.isCurrentlyConnectedToSpa = true;
        // Reset our knowledge of the state, since it will
        // almost certainly be out of date.
        this.resetRecentState();
        
        // Update homekit right away, and then again once some data comes in.
        // this.changesCallback();

        // listen for new messages from the spa. These can be replies to messages
        // We have sent, or can be the standard sending of status that the spa
        // seems to do every second.
        this.socket?.on('data', (data: any) => {
            var bufView = new Uint8Array(data);
            const somethingChanged = this.read_msg(bufView);
            if (somethingChanged) {
                // Only log state when something has changed.
                this.log.debug("State change:", this.stateToString());
                // Call whoever has registered with us - this is our homekit platform plugin
                // which will arrange to go through each accessory and check if the state of
                // it has changed. There are 3 cases here to be aware of:
                // 1) The user adjusted something in Home and therefore this callback is completely
                // unnecessary, since Home is already aware.
                // 2) The user adjusted something in Home, but that change could not actually take
                // effect - for example the user tried to turn off the primary filter pump during
                // a filtration cycle, and the Spa will ignore such a change.  In this case this
                // callback is essential for the Home app to reflect reality
                // 3) The user adjusted something using the physical spa controls (or the Balboa app),
                // and again this callback is essential for Home to be in sync with those changes.
                //
                // Theoretically we could be cleverer and not call this for the unnecessary cases, but
                // that seems like a lot of complex work for little benefit.  Also theoretically we
                // could specify just the controls that have changed, and hence reduce the amount of
                // activity.  But again little genuine benefit really from that, versus the code complexity
                // it would require.
                this.changesCallback();
            }
        });

        // No need to do this once we already have all the config information once.
        if (!this.accurateConfigReadFromSpa) {
            // Get the Spa's primary configuration of accessories right away
            this.sendControlTypesRequest();

            // Some testing things. Not yet sure of their use.
            // Note: must use 'let' here so id is bound separately each time.
            for (let id=0;id<4;id++) {
                setTimeout(() => {
                    this.sendControlPanelRequest(id);
                }, 1000*(id+1));
            }
            setTimeout(() => {
                this.send_config_request();
            }, 15000);  
        }

        // Wait 5 seconds after startup to send a request to check for any faults
        setTimeout(() => {
            if (this.isCurrentlyConnectedToSpa) {
                this.send_request_for_faults_log();
            }
            if (this.faultCheckIntervalId) {
                this.log.error("Shouldn't ever already have a fault check interval running here.");
            }
            // And then request again once every 10 minutes.
            this.faultCheckIntervalId = setInterval(() => {
                if (this.isCurrentlyConnectedToSpa) {
                    this.send_request_for_faults_log();
                }
            }, 10 * 60 * 1000);
        }, 5000);

    }

    reconnecting: boolean = false;
    reconnect(host: string) {
        if (!this.reconnecting) {
            this.reconnecting = true;
            setTimeout(() => {
                this.socket = this.get_socket(host);
                this.reconnecting = false;
            }, 20000);
        }
    }

    // Used if we get an error on the socket, as well as during shutdown.
    // If we got an error, after this the code will retry to recreate the
    // connection (elsewhere).
    shutdownSpaConnection() {
        // Might already be disconnected, if we're in a repeat error situation.
        this.isCurrentlyConnectedToSpa = false;
        this.log.debug("Shutting down Spa socket");
        if (this.faultCheckIntervalId) {
            clearInterval(this.faultCheckIntervalId);
            this.faultCheckIntervalId = undefined;
        }
        // Not sure I understand enough about these sockets to be sure
        // of best way to clean them up.
        if (this.socket != undefined) {
            this.socket.end();
            this.socket.destroy();
            this.socket = undefined;
        }
    }

    hasGoodSpaConnection() {
        return this.isCurrentlyConnectedToSpa;
    }
    
    /**
     * Message starts and ends with 0x7e. Needs a checksum.
     * @param purpose purely for logging clarity
     * @param type 
     * @param payload 
     */
    sendMessageToSpa(purpose: string, type: Uint8Array, payload: Uint8Array) {
        var length = (5 + payload.length);
        var typepayload = this.concat(type, payload);
        var checksum = this.compute_checksum(new Uint8Array([length]), typepayload);
        var prefixSuffix = new Uint8Array([0x7e]);
        var message = this.concat(prefixSuffix, new Uint8Array([length]));
        message = this.concat(message, typepayload);
        message = this.concat(message, new Uint8Array([checksum]));
        message = this.concat(message, prefixSuffix);
        this.log.debug(purpose, "Sending:" + this.prettify(message));
        this.socket?.write(message);
    }

    /**
     * Turn the bytes into a nice hex, comma-separated string like '0a,bf,2e'
     * @param message the bytes
     */
    prettify(message: Uint8Array) {
        return Buffer.from(message).toString('hex').match(/.{1,2}/g);
    }
    getTargetTemp() {
        return this.convertTemperature(true, this.tempRangeIsHigh 
            ? this.targetTempModeHigh : this.targetTempModeLow);
    }
    getTempIsCorF() {
        return this.temp_CorF;
    }
    getTempRangeIsHigh() {
        return this.tempRangeIsHigh;
    }
    timeToString(hour: number, minute: number) {
        return hour.toString().padStart(2, '0') + ":" + minute.toString().padStart(2, '0');
    }
    getIsLightOn(index: number) {
        // Lights are numbered 1,2 by Balboa
        index--;
        if (!this.ignoreAutomaticConfiguration && this.lightIsOn[index] == undefined) {
            this.log.error("Trying to get status of light",(index+1),"which doesn't exist");
            return false;
        }
        return this.lightIsOn[index];
    }
    getIsHeatingNow() {
        return this.isHeatingNow;
    }
    get_heating_mode() {
        return this.heatingMode;
    }
    getCurrentTemp() {
        if (this.currentTemp == undefined) {
            return undefined;
        } else {
            return this.convertTemperature(true, this.currentTemp);
        }
    }

    setLightState(index: number, value: boolean) {
        // Lights are numbered 1,2 by Balboa
        index--;
        if ((this.lightIsOn[index] === value)) {
            return;
        }
        if (!this.ignoreAutomaticConfiguration && this.lightIsOn[index] == undefined) {
            this.log.error("Trying to set state of light",(index+1),"which doesn't exist");
            return;
        }
        if (!this.isCurrentlyConnectedToSpa) {
            // Should we throw an error, or how do we handle this?
        }
        const id = 0x11+index;
        this.send_toggle_message(id);
        this.lightIsOn[index] = value;
    }

    setTempRangeIsHigh(isHigh: boolean) {
        if ((this.tempRangeIsHigh === isHigh)) {
            return;
        }
        this.send_toggle_message(0x50);
        this.tempRangeIsHigh = isHigh;
    }

    getFlowState() {
        return this.flow;
    }

    getPumpSpeed(index: number) {
        // Pumps are numbered 1,2,3,... by Balboa
        index--;
        if (!this.ignoreAutomaticConfiguration && this.pumpsSpeedRange[index] == 0) {
            this.log.error("Trying to get speed of pump",(index+1),"which doesn't exist");
            return PUMP_OFF;
        }
        return this.pumpsCurrentSpeed[index];
    }

    setPumpSpeed(index: number, value: string) {
        // Pumps are numbered 1,2,3,... by Balboa
        index--;
        if ((this.pumpsCurrentSpeed[index] === value)) {
            // No action needed if pump already at the desired speed
            return;
        }
        if (!this.ignoreAutomaticConfiguration && this.pumpsSpeedRange[index] == 0) {
            this.log.error("Trying to set speed of pump",(index+1),"which doesn't exist");
            return;
        }
        // Toggle Pump1 = toggle '4', Pump2 = toggle '5', etc.
        const balboaPumpId = index+4;
        if (this.pumpsSpeedRange[index] == 1) {
            // It is a 1-speed pump - just off or high settings
            if (value === PUMP_LOW) {
                this.log.warn("Pump", (index+1), ": Trying to set a 1 speed pump to LOW speed. Switching to HIGH instead.");
                value = PUMP_HIGH;
            }
            // Any change requires just one toggle. It's either from off to high or high to off
            this.send_toggle_message(balboaPumpId);
        } else {
            // How many toggles do we need to get from the current speed
            // to the desired speed?  For a 2-speed pump, allowed speeds are 0,1,2.
            // This code (but not other code in this class) should actually 
            // work as-is for 3-speed pumps if they exist.
            let loopThrough = this.pumpsSpeedRange[index]+1;
            let oldIdx = PUMP_STATES.indexOf(this.pumpsCurrentSpeed[index]);
            let newIdx = PUMP_STATES.indexOf(value);
            let count = (loopThrough + newIdx - oldIdx) % loopThrough;
            // For a 2-speed pump, we'll need to toggle either 1 or 2 times.
            while (count > 0) {
                this.send_toggle_message(balboaPumpId);
                count--;
            }
        }        
        this.pumpsCurrentSpeed[index] = value;
    }

    compute_checksum(length: Uint8Array, bytes: Uint8Array) {
        var checksum = crc.crc8(Buffer.from(this.concat(length, bytes)), 0x02);
        return checksum ^ 0x02;
    }
    
    concat(a: Uint8Array, b: Uint8Array) {
        var c = new Uint8Array(a.length + b.length);
        c.set(a);
        c.set(b, a.length);
        return c;
    }

    setTargetTemperature(temp: number) {
        var sendTemp;
        if (this.tempRangeIsHigh) {
            this.targetTempModeHigh = this.convertTemperature(false, temp);
            sendTemp = this.targetTempModeHigh;
        } else {
            this.targetTempModeLow = this.convertTemperature(false, temp);
            sendTemp = this.targetTempModeLow;
        }
        this.sendMessageToSpa("SetTargetTempRequest", SetTargetTempRequest, new Uint8Array([sendTemp]));
    }

    send_config_request() {
        this.sendMessageToSpa("ConfigRequest", ConfigRequest, new Uint8Array());
    }

    sendControlTypesRequest() {
        this.sendMessageToSpa("ControlTypesRequest", PrimaryRequest, ControlTypesMessageContents);
    }

    sendControlPanelRequest(id : number) {
        // 4 messages from [0x01,0x00,0x00] through 2,4,8
        this.sendMessageToSpa("ControlPanelRequest"+(id+1), PrimaryRequest, ControlPanelRequest[id][0]);
    }

    send_request_for_faults_log() {
        this.sendMessageToSpa("Checking for any Spa faults", PrimaryRequest, GetFaultsMessageContents);   
    }

    send_toggle_message(item: number) {
        if (item > 255) {
            this.log.error("Toggle only a single byte; had " + item);
            return;
        }
        // # 0x04 to 0x09 - pumps 1-6
        // # 0x11-0x12 - lights 1-2
        // # 0x3c - hold
        // # 0x51 - heating mode
        // # 0x50 - temperature range
        // # 0x0e - mister (unsupported at present)
        // # 0x0c - blower (unsupported at present)
        // # 0x16 - aux1, 0x17 - aux2
        this.sendMessageToSpa("Toggle item " + item, ToggleItemRequest, new Uint8Array([item, 0x00]));
    }

    // Celsius temperatures are communicated by the Spa in half degrees.
    convertTemperature(internalToExternal : boolean, temperature : number) {
        if (this.temp_CorF === "Fahrenheit") return temperature;
        // It's a celsius value which needs either dividing or multiplying by 2
        if (internalToExternal) {
            return temperature/2.0;
        } else {
            return Math.round(temperature * 2.0);
        }
    }

    temperatureToString(temperature? : number) {
        if (temperature == undefined) return "Unknown";
        if (this.temp_CorF === "Fahrenheit") return temperature.toString();
        return this.convertTemperature(true, temperature).toFixed(1).toString() 
    }

    stateToString() {
        var s = "Temp: " + this.temperatureToString(this.currentTemp) 
        + ", Target Temp(H): " + this.temperatureToString(this.targetTempModeHigh) 
        + ", Target Temp(L): " + this.temperatureToString(this.targetTempModeLow) 
        + ", Time: " + this.timeToString(this.hour, this.minute) +
        + ", Priming: " + this.priming.toString()
        + ", Heating Mode: " + this.heatingMode 
        + ", Temp Scale: " + this.temp_CorF
        + ", Time Scale: " + this.time_12or24  
        + ", Heating: " + this.isHeatingNow 
        + ", Temp Range: " + (this.tempRangeIsHigh ? "High" : "Low")
        + ", Pumps: " + this.pumpsCurrentSpeed
        + ", Circ Pump: " + this.circulationPumpIsOn
        + ", Lights: " + this.lightIsOn
        return s;
    }

    /**
     * Return true if anything important has changed as a result of the message
     * received.
     * 
     * @param chunk - first and last bytes are 0x7e. Second byte is message length.
     * Second-last byte is the checksum.  Then bytes 3,4,5 are the message type.
     * Everything in between is the content.
     */
    read_msg(chunk: Uint8Array) {
        if (chunk.length < 2) {
            return false;
        }
        // Length is the length of the message, which excludes the checksum and 0x7e end.
        var length = chunk[1];
        if (length == 0) {
            return false;
        }
        if (chunk[length] != this.compute_checksum(new Uint8Array([length]), chunk.slice(2,length))) {
            this.log.error("Bad checksum ", chunk[length], "for", this.prettify(chunk));
        }
        var contents = chunk.slice(5, length);
        var msgType = chunk.slice(2,5);
        if (this.equal(msgType,StateReply)) {
            return this.readStateFromBytes(contents);
        } else if (this.equal(msgType, GetFaultsReply)) {
            return this.readFaults(contents);
        } else if (this.equal(msgType, ControlTypesReply)) {
            this.log.info("Control types reply(" + this.prettify(msgType) 
             + "):"+ this.prettify(contents));
            this.interpretControlTypesReply(contents);
        } else if (this.equal(msgType, ConfigReply)) {
            this.log.info("Config reply with MAC address (" + this.prettify(msgType) 
            + "):"+ this.prettify(contents));
            // Bytes 3-8 are the MAC address of the Spa.  They are also repeated later
            // on in the string, but split into two halves with two bytes inbetween (ff, ff)
        } else {
            for (var id = 0; id<4; id++) {
                if (this.equal(msgType, ControlPanelRequest[id][1])) {
                    this.interpretControlPanelReply(id+1, contents);
                    return false;
                }
            }
            // Various messages about controls, filters, etc. In theory we could
            // choose to implement more things here, but limited value in it.
            this.log.info("Not understood a received spa message ", 
            "(nothing critical, but please do report this):" + this.prettify(msgType), 
            " contents: "+ this.prettify(contents));
        }
        return false;
    }

    resetRecentState() {
        this.lastStateBytes = new Uint8Array();
        this.lastFaultBytes = new Uint8Array();
    }

    /**
     * Interpret the standard response, which we are sent about every 1 second, covering
     * all of the primary state of the spa.
     * 
     * Return true if anything important has changed (i.e. ignore the time changing!)
     */
    readStateFromBytes(bytes: Uint8Array) {
        // If current_temp = 255, then the Spa is still not fully initialised
        // (but is not necessarily in "priming" state). Need to wait, really - after some seconds the
        // correct temperature is read.
        // Probably better to say the temperature is unknown, if homekit supports that.  The Balboa
        // app, for what it's worth, also is confused when current temp = 255.
        this.currentTemp = (bytes[2] == 255 ? undefined : bytes[2]);
        // Seems like priming goes through different states, so not sure this simplicity is correct
        this.priming = ((bytes[1] & 1) === 1);
        this.hour = bytes[3];
        this.minute = bytes[4];
        this.heatingMode = ["Ready", "Rest", "Ready in Rest"][bytes[5]];
        var unitsFlags = bytes[9];
        this.temp_CorF = (((unitsFlags & 1) === 0) ? "Fahrenheit" : "Celsius");
        this.time_12or24 = (((unitsFlags & 2) === 0) ? "12 Hr" : "24 Hr");
        var tempFlags = bytes[10];
        this.isHeatingNow = ((tempFlags & 48) !== 0);
        this.tempRangeIsHigh = (((tempFlags & 4) === 0) ? false : true);
        var pump_status1234 = bytes[11];
        // We have a correct determination of the number of pumps automatically.
        if (this.ignoreAutomaticConfiguration || this.pumpsCurrentSpeed[0] != PUMP_NOT_EXISTS) this.pumpsCurrentSpeed[0] = PUMP_STATES[(pump_status1234 & (1+2))];
        if (this.ignoreAutomaticConfiguration || this.pumpsCurrentSpeed[1] != PUMP_NOT_EXISTS) this.pumpsCurrentSpeed[1] = PUMP_STATES[((pump_status1234 & (4+8)) >> 2)];
        if (this.ignoreAutomaticConfiguration || this.pumpsCurrentSpeed[2] != PUMP_NOT_EXISTS) this.pumpsCurrentSpeed[2] = PUMP_STATES[((pump_status1234 & (16+32)) >> 4)];
        if (this.ignoreAutomaticConfiguration || this.pumpsCurrentSpeed[3] != PUMP_NOT_EXISTS) this.pumpsCurrentSpeed[3] = PUMP_STATES[((pump_status1234 & (64+128)) >> 6)];
        // pumps 5,6 are untested by me.
        var pump_status56 = bytes[12];
        if (this.ignoreAutomaticConfiguration || this.pumpsCurrentSpeed[4] != PUMP_NOT_EXISTS) this.pumpsCurrentSpeed[4] = PUMP_STATES[(pump_status56 & (1+2))];
        if (this.ignoreAutomaticConfiguration || this.pumpsCurrentSpeed[5] != PUMP_NOT_EXISTS) this.pumpsCurrentSpeed[5] = PUMP_STATES[((pump_status56 & (4+8)) >> 2)];
        // Not sure if this circ_pump index or logic is correct.
        this.circulationPumpIsOn = ((bytes[13] & 2) !== 0);
        if (this.ignoreAutomaticConfiguration || this.lightIsOn[0] != undefined) this.lightIsOn[0] = ((bytes[14] & (1+2)) === (1+2));
        if (this.ignoreAutomaticConfiguration || this.lightIsOn[1] != undefined) this.lightIsOn[1] = ((bytes[14] & (4+8)) === (4+8));
        // Believe the following 4 lines are correct, but no way to test
        // mister = data[15] & 0x01
        // blower = (data[13] & 0x0c) >> 2
        // aux1 = data[15] & 0x08
        // aux2 = data[15] & 0x10
        if (this.tempRangeIsHigh) {
            this.targetTempModeHigh = bytes[20];
        } else {
            this.targetTempModeLow = bytes[20];
        }
        // Store this for next time
        const oldBytes = this.lastStateBytes;
        this.lastStateBytes = new Uint8Array(bytes);
        // Return true if any values have changed
        if (oldBytes.length != this.lastStateBytes.length) return true;
        for (var i = 0; i < oldBytes.length; i++) {
            // Bytes 3,4 are the time
            if (i != 3 && i != 4) {
                if (oldBytes[i] !== this.lastStateBytes[i]) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get the set of accessories on this spa - how many pumps, lights, etc.
     * 
     * @param bytes 1a(=00011010),00,01,90,00,00 on my spa
     */
    interpretControlTypesReply(bytes: Uint8Array) {
        // 2 bits per pump. Pumps 5 and 6 are apparently P6xxxxP5 in the second byte
        // Line up all the bites in a row
        var pumpFlags1to6 = bytes[0] + 256 * (bytes[1] & 0x03) + 16 * (bytes[1] & 0xc0);
        var countPumps = 0;
        for (var idx = 0; idx < 6; idx++) {
            // 0 = no such pump, 1 = off/high pump, 2 = off/low/high pump
            this.pumpsSpeedRange[idx] = pumpFlags1to6 & 0x03;
            if (this.pumpsSpeedRange[idx] == 0) {
                this.pumpsCurrentSpeed[idx] = PUMP_NOT_EXISTS;
            } else {
                countPumps++;  
            }
            pumpFlags1to6 >>= 2;
        }
        this.log.info("Discovered", countPumps, "pumps with speeds", this.pumpsSpeedRange);
        var lights = [(bytes[2] & 0x03) != 0,(bytes[2] & 0xc0) != 0];
        // Store 'undefined' if the light doesn't exist. Else store 'false' which will
        // soon be over-ridden with the correct light on/off state.
        this.lightIsOn[0] = lights[0] ? false : undefined;
        this.lightIsOn[1] = lights[1] ? false : undefined;
        var countLights = (lights[0] ? 1 : 0) + (lights[1] ? 1 : 0);

        var circ_pump = (bytes[3] & 0x80) != 0;
        var blower = (bytes[3] & 0x03) != 0;
        var mister = (bytes[4] & 0x30) != 0;

        var aux = [(bytes[4] & 0x01) != 0,(bytes[4] & 0x02) != 0];
        this.log.info("Discovered",countLights,"light"+(countLights!=1?"s":""));
        this.log.info("Discovered other components: circ_pump",circ_pump,
            "blower",blower,"mister",mister,"aux",aux);
        this.accurateConfigReadFromSpa = true;
    }

    /**
     * Information returned from calls 1-4 here. Results shown below for my Spa.
     * 
     * 1: Filters: 14,00,01,1e,88,00,01,1e
     * - Bytes0-3: Filter start at 20:00, duration 1 hour 30 minutes
     * - Bytes4-7: Filter also start 8:00am (high-order bit says it is on), duration 1 hour 30 minutes
     * 2: 64,e1,24,00,4d,53,34,30,45,20,20,20,01,c3,47,96,36,03,0a,44,00
     * - First three bytes are the software id.  
     * - Bytes 5-12 (4d,53,34,30,45,20,20,20) are the motherboard model in ascii
     *   which is MS40E in this case (SIREV16 is a value reported by another user).
     * - After that comes 1 byte for 'current setup' and then 4 bytes which encode
     * the 'configuration signature'. 
     * 3: 05,01,32,63,50,68,61,07,41
     * - No idea?! ' cPha' is the ascii version of the middle 5 bytes - so probably not ascii!
     * 4: Reminders, cleaning cycle length, etc.: 00,85,00,01,01,02,00,00,00,00,00,00,00,00,00,00,00,00
     * - first 01 = temp scale (F or C)
     * - next 01 = time format (12hour or 24hour)
     * - 02 = cleaning cycle length in half hour increments
     * 
     * Mostly we don't choose to use any of the above information at present.
     * 
     * @param id 
     * @param contents 
     */
    interpretControlPanelReply(id: number, contents: Uint8Array) {
        this.log.info("Control Panel reply " + id + ":"+ this.prettify(contents));
        if (id == 1) {
            let filter1start = this.timeToString(contents[0], contents[1]);
            let filter1duration = this.timeToString(contents[2], contents[3]);
            let filter2on = (contents[4] & 0x80) != 0;
            let filter2start = this.timeToString(contents[4]&0x7f, contents[5]);
            let filter2duration = this.timeToString(contents[6], contents[7]);
            this.log.info("First filter time from",filter1start,"for",filter1duration);
            this.log.info("Second filter time", (filter2on ? 'on' : 'off'), 
            "from",filter2start,"for",filter2duration);
        } else if (id == 2) {
            let softwareID = "M" + contents[0] +"_"+contents[1]+" V"+contents[2];
            let currentSetup = contents[12];
            let configurationSignature = Buffer.from(contents.slice(13,17)).toString('hex');
            // Convert characters 5-12 into ascii
            let motherboard: string = "";
            (new Uint8Array(contents.slice(4,12))).forEach(function (byte: number) {
                motherboard += String.fromCharCode(byte);
            });
            // This is most of the information that shows up in the Spa display
            // when you go to the info screen.
            this.log.info("System Model", motherboard);
            this.log.info("SoftwareID (SSID)",softwareID);
            this.log.info("Current Setup",currentSetup);
            this.log.info("Configuration Signature",configurationSignature);
            // Not sure what the last 4 bytes 03-0a-44-00 mean
        }
    }

    /**
     * 	Get log of faults. Return true if there were faults of relevance
     */ 
    readFaults(bytes: Uint8Array) {
        var daysAgo = bytes[3];
        var hour = bytes[4];
        var minute = bytes[5];

        var code = bytes[2];
        // This is just the most recent fault.  We could query for others too.
        // (I believe by replacing 0xff in the request with a number), but for our
        // purposes the most recent only is sufficient 
        
        // Set flow to good, but possibly over-ride right below
        this.flow = FLOW_GOOD;

        let message : string;
        let returnValue = false;

        // Check if there are any new faults and report them.  I've chosen just to do 
        // that for codes 16 and 17.  But potentially any code except 19 (Priming) should
        // be alerted.  And priming is perhaps also useful since it indicates a restart.
        // Would be good to separate codes into ones which require immediate intervention
        // vs ones that might be ok for a few hours or days.

        if (daysAgo > 0) {
            message = "No recent faults. Last fault";
        } else if (code == 16 || code == 17) {
            // Water flow is low (16) or water flow failed (17). These generally indicate
            // the filter needs cleaning/change urgently. Hot tub will stop heating
            // and therefore cool down without a change. Important to alert the user
            // of them.
            this.flow = FLOW_STATES[code-15];
            // This state change will also be used to switch the thermostat control accessory into 
            // a state of 'off' when water flow fails.
            message = "Recent, alerted fault found";
            returnValue = true;
        } else {
            message = "Recent, but not alerted fault found:";
        }

        // Store this for next time
        const oldBytes = this.lastFaultBytes;
        this.lastFaultBytes = new Uint8Array(bytes);

        // To avoid annoyance, only log each fault once.
        if (!this.equal(oldBytes, this.lastFaultBytes)) {
            this.log.info(message, daysAgo, "days ago of type", "M0"+code,"=",this.faultCodeToString(code),"with details from log:", 
            "Fault Entries:", bytes[0], "Num:", bytes[1]+1,
            "Error code:", code, "Days ago:", daysAgo,
            "Time:", this.timeToString(hour, minute),
            "Heat mode:", bytes[6], "Set temp:", this.convertTemperature(true, bytes[7]), 
            "Temp A:", this.convertTemperature(true, bytes[8]), 
            "Temp B:", this.convertTemperature(true, bytes[9]));
        }
        
        return returnValue;
    }

    equal(one: Uint8Array, two: Uint8Array) {
        if (one.length != two.length) return false;
        for (var i = 0; i < one.length; i++) {
            if (one[i] !== two[i]) {
                return false;
            }
        }
        return true;
    }

    faultCodeToString(code: number) {
        if (code == 16) return "the water flow is low";
        if (code == 17) return "the water flow has failed";
        if (code == 19) return "priming (this is not actually a fault - your Spa was recently turned on)"
        if (code == 28) return "the heater may be dry";
        if (code == 27) return "the heater is dry";
        if (code == 30) return "the heater is too hot";
        if (code == 29) return "the water is too hot";
        if (code == 15) return "sensors are out of sync";
        if (code == 26) return "sensors are out of sync -- call for service";
        if (code == 31) return "sensor A fault";
        if (code == 32) return "sensor B fault";
        if (code == 22) return "program memory failure";
        if (code == 21) return "the settings have been reset (persistent memory error)";
        if (code == 20) return "the clock has failed";
        if (code == 36) return "the GFCI test failed";
        if (code == 34) return "a pump may be stuck on";
        if (code == 35) return "hot fault";
        return "unknown code - check Balboa spa manuals";
    }
}

