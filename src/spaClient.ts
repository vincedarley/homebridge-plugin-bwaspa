import * as crc from "crc";
import type { Logger } from 'homebridge';

const UNKNOWN_TEMPERATURE_VALUE = 255;
const PUMP_STATES = ["Off", "Low", "High"];
const FLOW_STATES = ["Good", "Low", "Failed"];

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
    targetTemp: number;
    hour: number;
    minute: number;
    heating_mode: string;
    temp_CorF: string;
    tempRangeIsHigh: boolean;
    pumps: string[];
    priming: boolean;
    time_scale: string;
    isHeatingNow: boolean;
    circ_pump: boolean;
    flow: string;

    constructor(public readonly log: Logger, public readonly host: string) {
        this.lightIsOn = false;
        this.currentTemp = 0;
        this.hour = 12;
        this.minute = 0;
        this.heating_mode = "";
        this.temp_CorF = "";
        this.tempRangeIsHigh = true;
        this.pumps = ["","","",""];
        this.targetTemp = 0;
        this.priming = false;
        this.time_scale = "12 Hr";
        this.isHeatingNow = false;
        this.circ_pump = false;
        this.flow = FLOW_STATES[0];
        this.socket = SpaClient.get_socket(log, host);
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
        // listen for new messages
        SpaClient.sock.on('data', function(data: any) {
            var bufView = new Uint8Array(data);
            SpaClient.instance.read_msg(bufView);
            log.debug(SpaClient.instance.stateToString());
        });
        SpaClient.sock.on('end', function() {
            log.debug("SpaClient:disconnected:");
        });
        SpaClient.sock.on('error', (error: any) => {
            log.debug(error);
            log.debug("Retrying in 20s");
            setTimeout( function() {
                SpaClient.get_socket(log, host);
            }, 20000)
        });

        // Wait 20 seconds after startup to send a request for any faults
        setTimeout( function() {
            SpaClient.instance.send_faults_message();
            // And then request again once each hour
            setInterval( function() {
                SpaClient.instance.send_faults_message();
            }, 60 * 60 * 1000);
        }, 20000)
        return SpaClient.sock;
    }
    /**
     * Message starts and ends with 0x7e. Needs a checksum.
     * @param type 
     * @param payload 
     */
    send_message(type: Uint8Array, payload: Uint8Array) {
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
        return this.convertTemperature(true, this.targetTemp);
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
        return this.heating_mode;
    }
    getCurrentTemp() {
        return this.convertTemperature(true, this.currentTemp);
    }
    setLightState(value: boolean) {
        if ((this.lightIsOn === value)) {
            return;
        }
        this.send_toggle_message(17);
        this.lightIsOn = value;
    }
    setTempRangeIsHigh(isHigh: boolean) {
        if ((this.tempRangeIsHigh === isHigh)) {
            return;
        }
        // TODO: don't know how to flip this.;
        this.tempRangeIsHigh = isHigh;
    }

    getFlowState() {
        return this.flow;
    }

    get_pump(index: number) {
        // Pumps are numbered 1,2,3,... by Balboa
        return this.pumps[index-1];
    }
    set_pump(index: number, value: string) {
        // Pumps are numbered 1,2,3,... by Balboa
        if ((this.pumps[index-1] === value)) {
            return;
        }
        // Pump1 = toggle '4', Pump2 = toggle '5', etc.
        const id = index+3;
        if (((value === "High") && (this.pumps[index-1] === "Off"))) {
            this.send_toggle_message(id);
            this.send_toggle_message(id);
        } else if (((value === "Off") && (this.pumps[index-1] === "Low"))) {
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
        this.targetTemp = this.convertTemperature(false, temp);
        this.send_message(SetTargetTempRequest, new Uint8Array([this.targetTemp]));
    }

    send_config_request() {
        this.send_message(ConfigRequest, new Uint8Array());
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
        // # 0x51 - heating mode
        // # 0x50 - temperature range
        // # 0x3c - hold
        this.log.debug("Sending message " + item);
        this.send_message(ToggleItemRequest, new Uint8Array([item, 0x00]));
    }

    send_faults_message() {
        this.log.debug("Checking for any Spa faults");
        this.send_message(GetFaultsRequest, new Uint8Array([0x20, 0xff, 0x00]));   
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
        + ", Target Temp: " + this.temperatureToString(this.targetTemp) 
        + ", Time: " + this.timeToString(this.hour, this.minute) + "\n"
        + "Priming: " + this.priming.toString()
        + ", Heating Mode: " + this.heating_mode 
        + ", Temp Scale: " + this.temp_CorF
        + ", Time Scale: " + this.time_scale + "\n" 
        + "Heating: " + this.isHeatingNow 
        + ", Temp Range: " + (this.tempRangeIsHigh ? "High" : "Low")
        + ", Pumps: " + this.pumps
        + ", Circ Pump: " + this.circ_pump
        + ", Light: " + this.lightIsOn
        return s;
    }

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
            this.readStateFromBytes(chunk.slice(5));
        } else if (chunk[2] == 0x0a && chunk[3] == 0xbf && chunk [4] == 0x28) {
            this.readFaults(chunk.slice(5));
        } else {
            this.log.error("Not understood a received message:", chunk.toString());
        }
        return true;
    }

    readStateFromBytes(bytes: Uint8Array) {
        // If current_temp = UNKNOWN_TEMPERATURE_VALUE (255), then the Spa is still not fully initialised
        // (but is not necessarily in "priming" state). Need to wait, really - after some seconds the
        // correct temperature is read.
        // Probably better to say the temperature is unknown, if homekit supports that.  The Balboa
        // app, for what it's worth, also is confused when current temp = 255.
        this.currentTemp = bytes[2];
        this.priming = ((bytes[1] & 1) === 1);
        this.hour = bytes[3];
        this.minute = bytes[4];
        this.heating_mode = ["Ready", "Rest", "Ready in Rest"][bytes[5]];
        var flag3 = bytes[9];
        this.temp_CorF = (((flag3 & 1) === 0) ? "Fahrenheit" : "Celsius");
        this.time_scale = (((flag3 & 2) === 0) ? "12 Hr" : "24 Hr");
        var flag4 = bytes[10];
        this.isHeatingNow = ((flag4 & 48) !== 0);
        this.tempRangeIsHigh = (((flag4 & 4) === 0) ? false : true);
        var pump_status = bytes[11];
        // How can we determine the number of pumps automatically?  The Balboa
        // app knows that, so it is possible.
        this.pumps[0] = PUMP_STATES[(pump_status & (1+2))];
        this.pumps[1] = PUMP_STATES[((pump_status & (4+8)) >> 2)];
        this.pumps[2] = PUMP_STATES[((pump_status & (16+32)) >> 4)];
        this.pumps[3] = PUMP_STATES[((pump_status & (64+128)) >> 6)];
        // Not sure if this circ_pump index or logic is correct.
        this.circ_pump = ((bytes[13] & 2) !== 0);
        this.lightIsOn = ((bytes[14] & 3) === 3);
        this.targetTemp = bytes[20];
    }

    /**
     * 	Get log of faults
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
        
        if (daysAgo > 1) {
            // Don't do anything for older faults.  Perhaps > 0??
            return;
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
        }
    }
}

