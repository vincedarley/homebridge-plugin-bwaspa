import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';
import { PUMP_STATES } from './spaClient'

/**
 * Control a 1- or 2- speed pump as a homekit "fan".
 * Where we have a 1 speed pump, only 'Off' and 'High' (speed = 0 or 2) are used.
 */
export class PumpAccessory {
  private service: Service;

  /**
   * Remember the last speed so that flipping the pump on/off will use the same 
   * speed as last time.
   */
  private states = {
    lastNonZeroSpeed: 2
  }

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
      .setCharacteristic(this.platform.Characteristic.Model, this.platform.model)
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

    // Important note: Home/Siri call both the "on" and the "setRotationSpeed" together when the pump
    // is turned from off to on. I've observed that using Siri the speed is set first, then 'on', and
    // with Home it is the opposite. The code needs to be robust to both cases, AND to the case where
    // the user just turns the pump on, but doesn't specify a speed (e.g. via a single tap on the pump
    // in Home) -- here we choose to store the "last speed" and use that for such cases.

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
   * It is possible that the Spa rejects this change, if the user is trying to turn the pump off, if it
   * is during a filter cycle. In that case the 'updateCharacteristics' callback below will end up
   * being called and that will discover the correct new value. 
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.platform.log.debug('Set Pump',this.pumpNumber,'->', value? 'On': 'Off', this.platform.status());
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
      return;
    }
    if (value as boolean) {
      this.scheduleSetSpeed(this.states.lastNonZeroSpeed);
    } else {
      this.scheduleSetSpeed(0);
    }
    
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
    this.platform.log.debug('Get Pump',this.pumpNumber,'<-',isOn?'On':'Off', this.platform.status());
    
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      callback(null, isOn);
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   * It is possible that the Spa rejects this change, if the user is trying to turn the pump off, if it
   * is during a filter cycle. In that case the 'updateCharacteristics' callback below will end up
   * being called and that will discover the correct new value.  
   */
  setRotationSpeed(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    // value is 0-100, and we want to convert that, irrespective of the number of
    // speeds we have to 0-2 (a 1-speed pump just swaps from 0 to 2 directly);
    const speed = Math.round((value as number)/50.0);
    // Store this immediately.
    this.states.lastNonZeroSpeed = speed;
    this.platform.log.debug('Set Pump',this.pumpNumber,'Speed ->', value, 'which is', PUMP_STATES[speed], this.platform.status());
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
      return;
    }
    this.scheduleSetSpeed(speed);

    callback(null);
  }

  /**
   * Handle "GET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  getRotationSpeed(callback: CharacteristicSetCallback) {
    const speed = this.getSpeed();
    // As above we convert the speed of 0-2 to a value of 0-100, irrespective
    // of the number of speeds the pump has
    const value = (100.0*speed)/2;
    this.platform.log.debug('Get Pump',this.pumpNumber,'Speed <-', value, 'which is', PUMP_STATES[speed], this.platform.status());
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      callback(null, value);
    }
  }

  // If Spa state has changed, for example using manual controls on the spa, then we must update Homekit.
  updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      this.platform.log.debug('Pump',this.pumpNumber,'updating',this.platform.status());
      this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.platform.connectionProblem);
      this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.platform.connectionProblem);
      return;
    }
    const speed = this.getSpeed();
    const isOn = speed != 0;
    const speedValue = (100.0*speed)/2;
    
    this.platform.log.debug('Pump',this.pumpNumber,'updating to',isOn,'and',speed);
    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(isOn);
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(speedValue);
  }

  private getSpeed() {
    // return 0, 1 or 2.
    return PUMP_STATES.indexOf(this.platform.spa.getPumpSpeed(this.pumpNumber));
  }

  private scheduleId : any = undefined;

  /** 
   * When the pump is turned on, we receive both an on setting (which triggers setting
   * the speed) and will usually also (depending on the user's actions) also receive 
   * an immediate follow-on setting of the speed as well.  We want to reconcile multiple
   * rapid speed settings to just a single set of the spa to avoid confusion.
   */
  private scheduleSetSpeed(speed: number) {
    let newSpeed = speed;
    if (this.scheduleId) {
      clearTimeout(this.scheduleId);
      this.scheduleId = undefined;
    }
    // Allow 10ms leeway for another set event.
    this.scheduleId = setTimeout(() => {
      this.setSpeed(newSpeed);
      this.scheduleId = undefined;
    }, 10);
  }

  private setSpeed(speed: number) {
    this.platform.log.debug('Pump',this.pumpNumber,'actually setting speed to',speed, this.platform.status());
    this.platform.spa.setPumpSpeed(this.pumpNumber, PUMP_STATES[speed]);
    if (speed != 0) {
      this.states.lastNonZeroSpeed = speed;
    }
  }
}
