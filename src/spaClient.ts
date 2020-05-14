import * as crc from "crc";
import type { Logger } from 'homebridge';

const UNKNOWN_TEMPERATURE_VALUE = 255;
export const PUMP_OFF = "Off";
export const PUMP_LOW = "Low";
export const PUMP_HIGH = "High";
export const PUMP_STATES = [PUMP_OFF, PUMP_LOW, PUMP_HIGH];
export const FLOW_GOOD = "Good";
export const FLOW_LOW = "Low";
export const FLOW_FAILED = "Failed";
export const FLOW_STATES = [FLOW_GOOD, FLOW_LOW, FLOW_FAILED];

const ToggleItemRequest = new Uint8Array([0x0a, 0xbf, 0x11]);
const ConfigRequest = new Uint8Array([0x0a, 0xbf, 0x04]);
const SetTargetTempRequest = new Uint8Array([0x0a, 0xbf, 0x20]);
const GetFaultsRequest = new Uint8Array([0x0a, 0xbf, 0x22]);

export class SpaClient {
    static instance: SpaClient;
    static sock: any;
    socket: any;
    lightIsOn: boolean;
    currentTemp: number;
    targetTempModeHigh: number;
    targetTempModeLow: number;
    hour: number;
    minute: number;
    heatingMode: string;
    temp_CorF: string;
    tempRangeIsHigh: boolean;
    pumps: string[];
    priming: boolean;
    time_12or24: string;
    isHeatingNow: boolean;
    circulationPump: boolean;
    flow: string;

    constructor(public readonly log: Logger, public readonly host: string) {
        this.lightIsOn = false;
        this.currentTemp = 0;
        this.hour = 12;
        this.minute = 0;
        this.heatingMode = "";
        this.temp_CorF = "";
        this.tempRangeIsHigh = true;
        this.pumps = ["","","",""];
        this.targetTempModeLow = 2*18;
        this.targetTempModeHigh = 2*38;
        this.priming = false;
        this.time_12or24 = "12 Hr";
        this.isHeatingNow = false;
        this.circulationPump = false;
        this.flow = FLOW_STATES[0];
        this.socket = SpaClient.get_socket(log, host);

        // Wait 20 seconds after startup to send a request to check for any faults
        setTimeout( function() {
            SpaClient.instance.send_request_for_faults_log();
            // And then request again once each hour.
            // TODO: Check that this works even if there's been a socket error in
            // the meantime and the socket has been regenerated.
            setInterval( function() {
                SpaClient.instance.send_request_for_faults_log();
            }, 60 * 60 * 1000);
        }, 20000);
    }

    static getSpaClient(log: Logger, host: string) {
        if (SpaClient.instance == null) {
            SpaClient.instance = new SpaClient(log, host);
        }
        return SpaClient.instance;
    }

    static get_socket(log: Logger, host: string) {
        var net = require('net');

        log.debug("Connecting to Spa at ", host, " on port 4257");
        SpaClient.sock = net.connect({
            port: 4257, 
            host: host
        }, function() {
            log.debug('Successfully connected to Spa at ', host, " on port 4257");
        });
        // listen for new messages from the spa. These can be replies to messages
        // We have sent, or can be the standard sending of status that the spa
        // seems to do every second.
        SpaClient.sock.on('data', function(data: any) {
            var bufView = new Uint8Array(data);
            const somethingChanged = SpaClient.instance.read_msg(bufView);
            if (somethingChanged) {
                // Only log state when something has changed.
                log.debug(SpaClient.instance.stateToString());
            }
        });
        SpaClient.sock.on('end', function() {
            log.debug("SpaClient:disconnected:");
        });
        // If we get an error, then retry
        SpaClient.sock.on('error', (error: any) => {
            log.debug(error);
            log.debug("Retrying in 20s");
            setTimeout( function() {
                SpaClient.instance.socket.end();
                SpaClient.instance.socket = SpaClient.get_socket(log, host);
            }, 20000);
        });

        return SpaClient.sock;
    }

    /**
     * Message starts and ends with 0x7e. Needs a checksum.
     * @param type 
     * @param payload 
     */
    sendMessageToSpa(type: Uint8Array, payload: Uint8Array) {
        var length = (5 + payload.length);
        var typepayload = this.concat(type, payload);
        var checksum = this.compute_checksum(new Uint8Array([length]), typepayload);
        var prefix = new Uint8Array([0x7e]);
        var message = this.concat(prefix, new Uint8Array([length]));
        message = this.concat(message, typepayload);
        message = this.concat(message, new Uint8Array([checksum]));
        message = this.concat(message, prefix);
        //this.log.debug("Writing:" + message.toString())
        SpaClient.sock.write(message);
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
    getIsLightOn() {
        return this.lightIsOn;
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
    setLightState(value: boolean) {
        if ((this.lightIsOn === value)) {
            return;
        }
        this.send_toggle_message(0x11);
        this.lightIsOn = value;
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
        if ((this.pumps[index-1] === value)) {
            return;
        }
        // Pump1 = toggle '4', Pump2 = toggle '5', etc.
        const id = index+3;
        if (((value === PUMP_HIGH) && (this.pumps[index-1] === PUMP_OFF))) {
            this.send_toggle_message(id);
            this.send_toggle_message(id);
        } else if (((value === PUMP_OFF) && (this.pumps[index-1] === PUMP_LOW))) {
            this.send_toggle_message(id);
            this.send_toggle_message(id);
        } else {
            this.send_toggle_message(id);
        }
        
        this.pumps[index-1] = value;
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
        this.sendMessageToSpa(SetTargetTempRequest, new Uint8Array([sendTemp]));
    }

    send_config_request() {
        this.sendMessageToSpa(ConfigRequest, new Uint8Array());
    }

    send_toggle_message(item: number) {
        if (item > 255) {
            this.log.error("Toggle only a single byte; had " + item);
            return;
        }
        // # 0x04 - pump 1
        // # 0x05 - pump 2
        // # 0x06 - pump 3
        // # 0x07 - pump 4 -- I assume this is true... not tested.
        // # 0x11 - light 1
        // # 0x3c - hold
        // # 0x51 - heating mode
        // # 0x50 - temperature range
        this.log.debug("Sending message " + item);
        this.sendMessageToSpa(ToggleItemRequest, new Uint8Array([item, 0x00]));
    }

    send_request_for_faults_log() {
        this.log.debug("Checking for any Spa faults");
        this.sendMessageToSpa(GetFaultsRequest, new Uint8Array([0x20, 0xff, 0x00]));   
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
        + ", Light: " + this.lightIsOn
        return s;
    }

    /**
     * Return true if anything important has changed as a result of the message
     * received.
     * 
     * @param chunk 
     */
    read_msg(chunk: Uint8Array) {
        if (chunk.length < 2) {
            return false;
        }
        var length = chunk[1];
        if (length == 0) {
            return false;
        }
        if (chunk[2] == 0xff && chunk[3] == 0xaf && chunk [4] == 0x13) {
            // "0xff 0xaf 0x13" = our primary state
            return this.readStateFromBytes(chunk.slice(5));
        } else if (chunk[2] == 0x0a && chunk[3] == 0xbf && chunk [4] == 0x28) {
            // "0x0a 0xbf 0x28" = faults log
            return this.readFaults(chunk.slice(5));
        } else {
            // Various messages about controls, filters, etc. In theory we could
            // choose to implement more things here, but limited value in it.
            this.log.info("Not understood a received spa message ", 
            "(likely user interacting with the screen controls):", chunk.toString());
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
        var pump_status = bytes[11];
        // How can we determine the number of pumps automatically?  The Balboa
        // app knows that, so it is possible.
        this.pumps[0] = PUMP_STATES[(pump_status & (1+2))];
        this.pumps[1] = PUMP_STATES[((pump_status & (4+8)) >> 2)];
        this.pumps[2] = PUMP_STATES[((pump_status & (16+32)) >> 4)];
        this.pumps[3] = PUMP_STATES[((pump_status & (64+128)) >> 6)];
        // Not sure if this circ_pump index or logic is correct.
        this.circulationPump = ((bytes[13] & 2) !== 0);
        this.lightIsOn = ((bytes[14] & 3) === 3);
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
            // Bytes 3,4 are the time, and byte 24 seems to change in pretty haphazard ways
            if (i != 3 && i != 4 && i != 24) {
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
        " Error code:", code, " Days ago:", daysAgo,
        " Time:", this.timeToString(hour, minute),
        " Heat mode ", bytes[6], " Set temp ", this.convertTemperature(true, bytes[7]), 
        " Temp A:", this.convertTemperature(true, bytes[8]), 
        " Temp B:", this.convertTemperature(true, bytes[9]));
        
        // Set flow to good, but possibly over-ride right below
        this.flow = FLOW_GOOD;

        if (daysAgo > 1) {
            // Don't do anything for older faults.  Perhaps > 0??
            this.log.debug("No recent faults. Last fault ", daysAgo, " days ago of type ", code);
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
            this.log.debug("Recent, relevant fault found: ", daysAgo, " days ago of type ", code);
            return true;
        }
        this.log.debug("Recent, but not relevant fault found: ", daysAgo, " days ago of type ", code);
        return false;
    }
}

