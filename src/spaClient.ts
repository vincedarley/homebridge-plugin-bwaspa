import * as crc from "crc";
import type { Logger } from 'homebridge';
import * as net from "net";

const UNKNOWN_TEMPERATURE_VALUE = 255;
export const PUMP_NOT_EXISTS = "-";
export const PUMP_OFF = "Off";
export const PUMP_LOW = "Low";
export const PUMP_HIGH = "High";
export const PUMP_STATES = [PUMP_OFF, PUMP_LOW, PUMP_HIGH];
export const FLOW_GOOD = "Good";
export const FLOW_LOW = "Low";
export const FLOW_FAILED = "Failed";
export const FLOW_STATES = [FLOW_GOOD, FLOW_LOW, FLOW_FAILED];

const GetFaultsRequest = new Uint8Array([0x0a, 0xbf, 0x22]);
const GetFaultsReply = new Uint8Array([0x0a,0xbf,0x28]);
// This one is sent to us automatically every second
const StateReply = new Uint8Array([0xff,0xaf,0x13]);
// These two either don't have a reply or we don't care about it.
const ToggleItemRequest = new Uint8Array([0x0a, 0xbf, 0x11]);
const SetTargetTempRequest = new Uint8Array([0x0a, 0xbf, 0x20]);
// These will tell us how many pumps, lights, etc the Spa has
const ControlTypesRequest = new Uint8Array([0x0a, 0xbf, 0x22]);
const ControlTypesReply = new Uint8Array([0x0a,0xbf,0x2e]);
// These we send once, but don't actually currently make use of the results
// Need to investigate how to interpret them. 
const ConfigRequest = new Uint8Array([0x0a, 0xbf, 0x04]);
const ConfigReply = new Uint8Array([0x0a,0xbf,0x94]);
const ControlConfig2Request = new Uint8Array([0x0a, 0xbf, 0x2e]);
const ControlConfig2Reply = new Uint8Array([0x0a,0xbf,0x25]);

export class SpaClient {
    socket?: net.Socket;
    lightIsOn: boolean[];
    currentTemp: number;
    targetTempModeHigh: number;
    targetTempModeLow: number;
    hour: number;
    minute: number;
    heatingMode: string;
    temp_CorF: string;
    tempRangeIsHigh: boolean;
    pumps: string[];
    pumpSpeeds: number[];
    priming: boolean;
    time_12or24: string;
    isHeatingNow: boolean;
    circulationPump: boolean;
    flow: string;
    // Once the Spa has told us what accessories it really has.
    accurateConfigReadFromSpa: boolean;
    isCurrentlyConnectedToSpa: boolean;
    ignoreAutomaticConfiguration: boolean;

    constructor(public readonly log: Logger, public readonly host: string, ignoreAutomatic?: boolean) {
        this.accurateConfigReadFromSpa = false;
        this.isCurrentlyConnectedToSpa = false;
        this.ignoreAutomaticConfiguration = (ignoreAutomatic ? ignoreAutomatic : false);
        this.lightIsOn = [false,false];
        this.currentTemp = 0;
        this.hour = 12;
        this.minute = 0;
        this.heatingMode = "";
        this.temp_CorF = "";
        this.tempRangeIsHigh = true;
        // Be generous to start.  Once we've read the config, we'll set reduce
        // the number of pumps and their number of speeds correctly
        this.pumps = [PUMP_OFF,PUMP_OFF,PUMP_OFF,PUMP_OFF,PUMP_OFF,PUMP_OFF];
        this.pumpSpeeds = [2,2,2,2,2,2];
        this.targetTempModeLow = 2*18;
        this.targetTempModeHigh = 2*38;
        this.priming = false;
        this.time_12or24 = "12 Hr";
        this.isHeatingNow = false;
        this.circulationPump = false;
        this.flow = FLOW_STATES[0];
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
            this.log.debug('Successfully connected to Spa at', host, "on port 4257");
            this.successfullyConnectedToSpa();
        });
        this.socket?.on('end', () => {
            this.log.debug("SpaClient: disconnected:");
        });
        // If we get an error, then retry
        this.socket?.on('error', (error: any) => {
            this.log.debug(error /* , this.socket */);
            this.log.debug("Closing old socket, retrying in 20s");
            
            this.shutdownSpaConnection();
            this.reconnect(host);
        });
        
        return this.socket;
    }

    successfullyConnectedToSpa() {
        this.isCurrentlyConnectedToSpa = true;
        // listen for new messages from the spa. These can be replies to messages
        // We have sent, or can be the standard sending of status that the spa
        // seems to do every second.
        this.socket?.on('data', (data: any) => {
            var bufView = new Uint8Array(data);
            const somethingChanged = this.read_msg(bufView);
            if (somethingChanged) {
                // Only log state when something has changed.
                this.log.debug(this.stateToString());
            }
        });

        // Get the Spa's primary configuration of accessories right away
        this.send_control_panel_request();

        // Wait 5 seconds after startup to send a request to check for any faults
        setTimeout(() => {
            this.send_request_for_faults_log();
            // And then request again once every 10 minutes.
            // TODO: Check that this works even if there's been a socket error in
            // the meantime and the socket has been regenerated.
            setInterval(() => {
                this.send_request_for_faults_log();
            }, 10 * 60 * 1000);
        }, 5000);

        // Some testing things. Not yet sure of their use.
        setTimeout(() => {
            this.send_control_config_2_request();
        }, 10000);
        setTimeout(() => {
            this.send_config_request();
        }, 15000);  
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
        // Not sure I understand enough about these sockets to be sure
        // of best way to clean them up.
        if (this.socket != undefined) {
            //this.log.debug('Before:', this.socket);
            this.socket.end();
            //this.log.debug('After:', this.socket);
            this.socket = undefined;
        }
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
        return hour.toString().padStart(2, '0') + ":" 
        + minute.toString().padStart(2, '0');
    }
    getIsLightOn(index: number) {
        return this.lightIsOn[index-1];
    }
    getIsHeatingNow() {
        return this.isHeatingNow;
    }
    get_heating_mode() {
        return this.heatingMode;
    }
    getCurrentTemp() {
        return this.convertTemperature(true, this.currentTemp);
    }

    setLightState(index: number, value: boolean) {
        if ((this.lightIsOn[index-1] === value)) {
            return;
        }
        if (!this.isCurrentlyConnectedToSpa) {
            // Should we throw an error, or how do we handle this?
        }
        // Lights numbered 1,2
        const id = 0x11+index-1;
        this.send_toggle_message(id);
        this.lightIsOn[index-1] = value;
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
        return this.pumps[index-1];
    }

    setPumpSpeed(index: number, value: string) {
        // Pumps are numbered 1,2,3,... by Balboa
        index--;
        if ((this.pumps[index] === value)) {
            // No action needed if pump already at the desired speed
            return;
        }
        if (!this.ignoreAutomaticConfiguration && this.pumpSpeeds[index] == 0) {
            this.log.error("Trying to set speed of pump",(index+1),"which doesn't exist");
            return;
        }
        // Toggle Pump1 = toggle '4', Pump2 = toggle '5', etc.
        const id = index+4;
        if (this.pumpSpeeds[index] == 1) {
            // 1 speed pump - just off or high settings
            if (value === PUMP_LOW) {
                this.log.warn("Pump", (index+1), ": Trying to set a 1 speed pump to LOW speed. Switching to HIGH instead.");
                value = PUMP_HIGH;
            }
            // Any change requires just one toggle. It's either from off to high or high to off
            this.send_toggle_message(id);
        } else {
            // 2 speed pump. If 3 speed pumps exist, not hard to support in the future.
            if (((value === PUMP_HIGH) && (this.pumps[index] === PUMP_OFF))) {
                // Going from off to high requires 2 toggles
                this.send_toggle_message(id);
                this.send_toggle_message(id);
            } else if (((value === PUMP_OFF) && (this.pumps[index] === PUMP_LOW))) {
                // Going from low to off requires 2 toggles
                this.send_toggle_message(id);
                this.send_toggle_message(id);
            } else {
                // Anything else requires 1 toggle
                this.send_toggle_message(id);
            }
        }        
        this.pumps[index] = value;
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

    send_control_panel_request() {
        this.sendMessageToSpa("ControlTypesRequest", ControlTypesRequest, new Uint8Array([0x00, 0x00, 0x01]));
    }

    send_control_config_2_request() {
        this.sendMessageToSpa("ControlConfig2Request", ControlConfig2Request, new Uint8Array([0x04, 0x00, 0x00]));
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

    send_request_for_faults_log() {
        this.sendMessageToSpa("Checking for any Spa faults", GetFaultsRequest, new Uint8Array([0x20, 0xff, 0x00]));   
    }

    // Celsius temperatures are communicated by the Spa in half degrees.
    convertTemperature(internalToExternal : boolean, temperature : number) {
        if (this.temp_CorF === "Fahrenheit" || temperature == UNKNOWN_TEMPERATURE_VALUE) return temperature;
        // It's a celsius value which needs either dividing or multiplying by 2
        if (internalToExternal) {
            return temperature/2.0;
        } else {
            return Math.round(temperature * 2.0);
        }
    }

    temperatureToString(temperature : number) {
        if (temperature == UNKNOWN_TEMPERATURE_VALUE) return "Unknown";
        if (this.temp_CorF === "Fahrenheit") return temperature.toString();
        return this.convertTemperature(true, temperature).toFixed(1).toString() 
    }

    stateToString() {
        var s = "Temp: " + this.temperatureToString(this.currentTemp) 
        + ", Target Temp(H): " + this.temperatureToString(this.targetTempModeHigh) 
        + ", Target Temp(L): " + this.temperatureToString(this.targetTempModeLow) 
        + ", Time: " + this.timeToString(this.hour, this.minute) + "\n"
        + "Priming: " + this.priming.toString()
        + ", Heating Mode: " + this.heatingMode 
        + ", Temp Scale: " + this.temp_CorF
        + ", Time Scale: " + this.time_12or24 + "\n" 
        + "Heating: " + this.isHeatingNow 
        + ", Temp Range: " + (this.tempRangeIsHigh ? "High" : "Low")
        + ", Pumps: " + this.pumps
        + ", Circ Pump: " + this.circulationPump
        + ", Lights: " + this.lightIsOn
        return s;
    }

    // Just for message reply types which we know are of length 3.
    equal(a: Uint8Array, b: Uint8Array) {
        return (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
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
        } else if (this.equal(msgType, ControlConfig2Reply)) {
            // TODO: interpret this
            this.log.info("Control config 2 reply(" + this.prettify(msgType) 
            + "):"+ this.prettify(contents));
        } else if (this.equal(msgType, ConfigReply)) {
            // TODO: interpret this
            this.log.info("Config reply(" + this.prettify(msgType) 
            + "):"+ this.prettify(contents));
        } else {
            // Various messages about controls, filters, etc. In theory we could
            // choose to implement more things here, but limited value in it.
            this.log.info("Not understood a received spa message ", 
            "(nothing critical, but please do report this):" + this.prettify(msgType), 
            " contents: "+ this.prettify(contents));
        }
        return false;
    }

    lastStateBytes = new Uint8Array(1);

    /**
     * Interpret the standard response, which we are sent about every 1 second, covering
     * all of the primary state of the spa.
     * 
     * Return true if anything important has changed (i.e. ignore the time changing!)
     */
    readStateFromBytes(bytes: Uint8Array) {
        // If current_temp = UNKNOWN_TEMPERATURE_VALUE (255), then the Spa is still not fully initialised
        // (but is not necessarily in "priming" state). Need to wait, really - after some seconds the
        // correct temperature is read.
        // Probably better to say the temperature is unknown, if homekit supports that.  The Balboa
        // app, for what it's worth, also is confused when current temp = 255.
        this.currentTemp = bytes[2];
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
        if (this.ignoreAutomaticConfiguration || this.pumps[0] != PUMP_NOT_EXISTS) this.pumps[0] = PUMP_STATES[(pump_status1234 & (1+2))];
        if (this.ignoreAutomaticConfiguration || this.pumps[1] != PUMP_NOT_EXISTS) this.pumps[1] = PUMP_STATES[((pump_status1234 & (4+8)) >> 2)];
        if (this.ignoreAutomaticConfiguration || this.pumps[2] != PUMP_NOT_EXISTS) this.pumps[2] = PUMP_STATES[((pump_status1234 & (16+32)) >> 4)];
        if (this.ignoreAutomaticConfiguration || this.pumps[3] != PUMP_NOT_EXISTS) this.pumps[3] = PUMP_STATES[((pump_status1234 & (64+128)) >> 6)];
        // pumps 5,6 are untested by me.
        var pump_status56 = bytes[12];
        if (this.ignoreAutomaticConfiguration || this.pumps[4] != PUMP_NOT_EXISTS) this.pumps[4] = PUMP_STATES[(pump_status56 & (1+2))];
        if (this.ignoreAutomaticConfiguration || this.pumps[5] != PUMP_NOT_EXISTS) this.pumps[5] = PUMP_STATES[((pump_status56 & (4+8)) >> 2)];
        // Not sure if this circ_pump index or logic is correct.
        this.circulationPump = ((bytes[13] & 2) !== 0);
        this.lightIsOn[0] = ((bytes[14] & (1+2)) === (1+2));
        this.lightIsOn[1] = ((bytes[14] & (4+8)) === (4+8));
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
                    // this.log.debug("OLD:", oldBytes.toString());
                    // this.log.debug("NEW:", this.lastStateBytes.toString());
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
            this.pumpSpeeds[idx] = pumpFlags1to6 & 0x03;
            if (this.pumpSpeeds[idx] == 0) {
                this.pumps[idx] = PUMP_NOT_EXISTS;
            } else {
                countPumps++;  
            }
            pumpFlags1to6 >>= 2;
        }
        this.log.info("Discovered", countPumps, "pumps with speeds", this.pumpSpeeds);
        var lights = [(bytes[2] & 0x03) != 0,(bytes[2] & 0xc0) != 0];

        var circ_pump = (bytes[3] & 0x80) != 0;
        var blower = (bytes[3] & 0x03) != 0;
        var mister = (bytes[4] & 0x30) != 0;

        var aux = [(bytes[4] & 0x01) != 0,(bytes[4] & 0x02) != 0];
        this.log.info("Discovered lights:",lights,"circ_pump",circ_pump,
        "blower",blower,"mister",mister,"aux",aux);
        this.accurateConfigReadFromSpa = true;
    }

    /**
     * 	Get log of faults. Return true if there were faults of relevance
     */ 
    readFaults(bytes: Uint8Array) {
        var daysAgo = bytes[3];
        var hour = bytes[4];
        var minute = bytes[5];

        var code = bytes[2];
        // This is just the most recent fault.  We can query for others too.
        // (I believe by replacing 0xff in the request with a number) 
        this.log.debug("Fault Entries:", bytes[0], "Num:", bytes[1]+1,
        "Error code:", code, "Days ago:", daysAgo,
        "Time:", this.timeToString(hour, minute),
        "Heat mode:", bytes[6], "Set temp:", this.convertTemperature(true, bytes[7]), 
        "Temp A:", this.convertTemperature(true, bytes[8]), 
        "Temp B:", this.convertTemperature(true, bytes[9]));
        
        // Set flow to good, but possibly over-ride right below
        this.flow = FLOW_GOOD;

        if (daysAgo > 1) {
            // Don't do anything for older faults.  Perhaps > 0??
            this.log.debug("No recent faults. Last fault", daysAgo, "days ago of type", code);
            return false;
        }

        // Check if there are any new faults and report them.  I've chosen just to do 
        // that for codes 16 and 17.  But potentially any code except 19 (Priming) should
        // be alerted.  And priming is perhaps also useful since it indicates a restart.
        // Would be good to separate codes into ones which require immediate intervention
        // vs ones that might be ok for a few hours or days.
        if (code == 16 || code == 17) {
            // Water flow is low (16) or water flow failed (17). These generally indicate
            // the filter needs cleaning/change urgently. Hot tub will stop heating
            // and therefore cool down without a change. Important to alert the user
            // of them.
            this.flow = FLOW_STATES[code-15];
            // It may also make sense to switch the thermostat control accessory into 
            // a state of 'cooling' or 'off' when water flow fails.
            this.log.debug("Recent, relevant fault found:", daysAgo, "days ago of type", code);
            return true;
        }
        this.log.debug("Recent, but not relevant fault found:", daysAgo, "days ago of type", code);
        return false;
    }
}

