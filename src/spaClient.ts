import * as crc from "crc";
import type { Logger } from 'homebridge';

const UNKNOWN_TEMPERATURE_VALUE = 255;
    
export class SpaClient {
    static instance: SpaClient;
    static sock: any;
    socket: any;
    light: boolean;
    current_temp: number;
    hour: number;
    minute: number;
    heating_mode: string;
    temp_scale: string;
    temp_range: string;
    pump1: string;
    pump2: string;
    pump3: string;
    set_temp: number;
    priming: boolean;
    time_scale: string;
    heating: boolean;
    circ_pump: boolean;
    
    constructor(public readonly log: Logger, public readonly host: string) {
        this.light = false;
        this.current_temp = 0;
        this.hour = 12;
        this.minute = 0;
        this.heating_mode = "";
        this.temp_scale = "";
        this.temp_range = "";
        this.pump1 = "";
        this.pump2 = "";
        this.pump3 = "";
        this.set_temp = 0;
        this.priming = false;
        this.time_scale = "12 Hr";
        this.heating = false;
        this.circ_pump = false;
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

        return SpaClient.sock;
    }

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

    get_set_temp() {
        return this.convertTemperature(true, this.set_temp);
    }
    get_pump1() {
        return this.pump1;
    }
    get_pump2() {
        return this.pump2;
    }
    get_pump3() {
        return this.pump3;
    }
    get_temp_range() {
        return this.temp_range;
    }
    get_current_time() {
        return this.hour.toString().padStart(2, '0') + ":" 
        + this.minute.toString().padStart(2, '0');
    }
    get_light() {
        return this.light;
    }
    get_current_temp() {
        return this.convertTemperature(true, this.current_temp);
    }
    set_light(value: boolean) {
        if ((this.light === value)) {
            return;
        }
        this.send_toggle_message(17);
        this.light = value;
    }
    set_pump1(value: string) {
        if ((this.pump1 === value)) {
            return;
        }
        if (((value === "High") && (this.pump1 === "Off"))) {
            this.send_toggle_message(4);
            this.send_toggle_message(4);
        } else {
            if (((value === "Off") && (this.pump1 === "Low"))) {
                this.send_toggle_message(4);
                this.send_toggle_message(4);
            } else {
                this.send_toggle_message(4);
            }
        }
        this.pump1 = value;
    }
    set_pump2(value: string) {
        if ((this.pump2 === value)) {
            return;
        }
        if (((value === "High") && (this.pump2 === "Off"))) {
            this.send_toggle_message(5);
            this.send_toggle_message(5);
        } else {
            if (((value === "Off") && (this.pump2 === "Low"))) {
                this.send_toggle_message(5);
                this.send_toggle_message(5);
            } else {
                this.send_toggle_message(5);
            }
        }
        this.pump2 = value;
    }
    set_pump3(value: string) {
        if ((this.pump3 === value)) {
            return;
        }
        if (((value === "High") && (this.pump3 === "Off"))) {
            this.send_toggle_message(6);
            this.send_toggle_message(6);
        } else {
            if (((value === "Off") && (this.pump3 === "Low"))) {
                this.send_toggle_message(6);
                this.send_toggle_message(6);
            } else {
                this.send_toggle_message(6);
            }
        }
        this.pump3 = value;
    }
    
    compute_checksum(length: Uint8Array, bytes: Uint8Array) {
        var checksum = crc.crc8(new Buffer(this.concat(length, bytes)), 0x02);
        return checksum ^ 0x02;
    }
    
    concat(a: Uint8Array, b: Uint8Array) {
        var c = new Uint8Array(a.length + b.length);
        c.set(a);
        c.set(b, a.length);
        return c;
    }

    set_temperature(temp: number) {
        this.set_temp = this.convertTemperature(false, temp);
        this.send_message(new Uint8Array([0x0a, 0xbf, 0x20]), new Uint8Array([this.set_temp]));
    }

    send_config_request() {
        this.send_message(new Uint8Array([0x0a, 0xbf, 0x04]), new Uint8Array());
    }

    send_toggle_message(item: number) {
        if (item > 255) {
            this.log.error("Toggle only a single byte; had " + item);
            return;
        }
        // # 0x04 - pump 1
        // # 0x05 - pump 2
        // # 0x06 - pump 3
        // # 0x11 - light 1
        // # 0x51 - heating mode
        // # 0x50 - temperature range

        this.log.debug("Sending message " + item);
        this.send_message(new Uint8Array([0x0a, 0xbf, 0x11]), new Uint8Array([item, 0x00]));
    }

    // Celsius temperatures are communicated by the Spa in half degrees.
    convertTemperature(internalToExternal : boolean, temperature : number) {
        if (this.temp_scale == "Fahrenheit" || temperature == UNKNOWN_TEMPERATURE_VALUE) return temperature;
        // It's a celsius value which needs either dividing or multiplying by 2
        if (internalToExternal) {
            return temperature/2.0;
        } else {
            return Math.round(temperature * 2.0);
        }
    }

    temperatureToString(temperature : number) {
        if (temperature == UNKNOWN_TEMPERATURE_VALUE) return "Unknown";
        if (this.temp_scale == "Fahrenheit") return temperature.toString();
        return this.convertTemperature(true, temperature).toFixed(1).toString() 
    }

    stateToString() {
        var s = "Temp: " + this.temperatureToString(this.current_temp) 
        + ", Set Temp: " + this.temperatureToString(this.set_temp) 
        + ", Time: " + this.hour.toString().padStart(2, '0') + ":" 
        + this.minute.toString().padStart(2, '0') + "\n"
        + "Priming: " + this.priming.toString()
        + ", Heating Mode: " + this.heating_mode 
        + ", Temp Scale: " + this.temp_scale
        + ", Time Scale: " + this.time_scale + "\n" 
        + "Heating: " + this.heating 
        + ", Temp Range: " + this.temp_range
        + ", Pump1: " + this.pump1
        + ", Pump2: " + this.pump2
        + ", Pump3: " + this.pump3
        + ", Circ Pump: " + this.circ_pump
        + ", Light: " + this.light
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
        if (chunk[2] == 255 && chunk[3] == 175 && chunk [4] == 19) {
            this.readStateFromBytes(chunk.slice(5));
        }
        return true;
    }

    readStateFromBytes(byte_array: Uint8Array) {
        this.current_temp = byte_array[2];
        // If current_temp = UNKNOWN_TEMPERATURE_VALUE, then the Spa is still not fully initialised
        // (but is not necessarily in "priming" state). Need to wait, really - after some seconds the
        // correct temperature is read.
        // Probably better to say the temperature is unknown, if homekit supports that.
        this.priming = ((byte_array[1] & 1) === 1);
        this.hour = byte_array[3];
        this.minute = byte_array[4];
        this.heating_mode = ["Ready", "Rest", "Ready in Rest"][byte_array[5]];
        var flag3 = byte_array[9];
        this.temp_scale = (((flag3 & 1) === 0) ? "Fahrenheit" : "Celsius");
        this.time_scale = (((flag3 & 2) === 0) ? "12 Hr" : "24 Hr");
        var flag4 = byte_array[10];
        this.heating = ((flag4 & 48) !== 0);
        this.temp_range = (((flag4 & 4) === 0) ? "Low" : "High");
        var pump_status = byte_array[11];
        this.pump1 = ["Off", "Low", "High"][(pump_status & 3)];
        this.pump2 = ["Off", "Low", "High"][((pump_status & 12) >> 2)];
        this.pump3 = ["Off", "Low", "High"][((pump_status & 48) >> 4)];
        // Not sure if this circ_pump index or logic is correct.
        this.circ_pump = ((byte_array[13] & 2) !== 0);
        this.light = ((byte_array[14] & 3) === 3);
        this.set_temp = byte_array[20];
    }

}

