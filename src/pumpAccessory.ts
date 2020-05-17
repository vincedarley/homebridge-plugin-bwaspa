import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';
import { PUMP_STATES } from './spaClient'

/**
 * Control a 1- or 2- speed pump as a homekit "fan"
 */
export class PumpAccessory {
  private service: Service;

  /**
   * Remember the last speed so that flipping the pump on/off will use the same 
   * speed as last time.
   */
  private states = {
    lastSpeed: 2
  }

  // Where we have a 1 speed pump, only 'Off' and 'High' are used.
  private readonly speeds: string[] = PUMP_STATES;
  // Always 1 or 2
  numSpeedSettings : number;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly pumpNumber : number
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Balboa')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, VERSION);

    // get the Fan service if it exists, otherwise create a new Fan service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Fan) ?? this.accessory.addService(this.platform.Service.Fan);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
    this.numSpeedSettings = accessory.context.device.pumpRange;
    if (this.numSpeedSettings != 1 && this.numSpeedSettings != 2) {
      this.platform.log.warn("Bad speed settings:", this.numSpeedSettings, " should be 1 or 2.");
      this.numSpeedSettings = 1;
    }

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on(CharacteristicEventTypes.SET, this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on(CharacteristicEventTypes.GET, this.getOn.bind(this));               // GET - bind to the `getOn` method below

    // register handlers for the RotationSpeed Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .on(CharacteristicEventTypes.SET, this.setRotationSpeed.bind(this))        // SET - bind to the 'setRotationSpeed` method below
      .setProps({minStep: (this.numSpeedSettings == 1 ? 100.0 : 50.0)})
      .on(CharacteristicEventTypes.GET, this.getRotationSpeed.bind(this));       // GET - bind to the 'getRotationSpeed` method below

  }

  /**
   * Handle "SET" requests from HomeKit
   * Turns the device on or off.
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    if (value as boolean) {
      this.setSpeed(this.states.lastSpeed);
    } else {
      this.setSpeed(0);
    }
    this.platform.log.debug('Set Pump Characteristic On ->', value);

    callback(null);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getOn(callback: CharacteristicGetCallback) {
    const isOn = this.getSpeed() != 0;
    this.platform.log.debug('Get Pump Characteristic On ->', isOn);

    callback(null, isOn);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  setRotationSpeed(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const speed = Math.round((value as number)*this.numSpeedSettings/100.0);
    this.setSpeed(speed);
    this.platform.log.debug('Set Pump Characteristic Speed -> ', value, ' which is ', this.speeds[speed]);

    callback(null);
  }

  /**
   * Handle "GET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  getRotationSpeed(callback: CharacteristicSetCallback) {
    const speed = this.getSpeed();
    const value = (100.0*speed)/this.numSpeedSettings;
    this.platform.log.debug('Get Pump Characteristic Speed -> ', value, ' which is ', this.speeds[speed]);

    callback(null, value);
  }

  private getSpeed() {
    return this.speeds.indexOf(this.platform.spa.getPumpSpeed(this.pumpNumber));
  }

  private setSpeed(speed: number) {
    this.platform.spa.setPumpSpeed(this.pumpNumber, this.speeds[speed]);
    if (speed != 0) {
      this.states.lastSpeed = speed;
    }
  }
}
