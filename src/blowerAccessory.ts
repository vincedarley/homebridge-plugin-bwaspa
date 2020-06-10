import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';

/**
 * Control a 1-3 speed blower as a homekit "fan".
 */
export class BlowerAccessory {
  private service: Service;

  /**
   * Remember the last speed so that flipping the blower on/off will use the same 
   * speed as last time.
   */
  private states = {
    lastNonZeroSpeed: 1
  }

  // Always 1-3
  numSpeedSettings : number;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: PlatformAccessory
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
    this.numSpeedSettings = 0;
    
    // Important note: Home/Siri call both the "on" and the "setRotationSpeed" together when the blower
    // is turned from off to on. I've observed that using Siri the speed is set first, then 'on', and
    // with Home it is the opposite. The code needs to be robust to both cases, AND to the case where
    // the user just turns the blower on, but doesn't specify a speed (e.g. via a single tap on the blower
    // in Home) -- here we choose to store the "last speed" and use that for such cases.

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on(CharacteristicEventTypes.SET, this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on(CharacteristicEventTypes.GET, this.getOn.bind(this));               // GET - bind to the `getOn` method below

    // register handlers for the RotationSpeed Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .on(CharacteristicEventTypes.SET, this.setRotationSpeed.bind(this))        // SET - bind to the 'setRotationSpeed` method below
      .on(CharacteristicEventTypes.GET, this.getRotationSpeed.bind(this));       // GET - bind to the 'getRotationSpeed` method below

  }

  /**
   * Handle "SET" requests from HomeKit
   * Turns the device on or off.
   * It is possible that the Spa rejects this change, if the user is trying to turn the blower off, if it
   * is during a filter cycle. In that case the 'updateCharacteristics' callback below will end up
   * being called and that will discover the correct new value. 
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.platform.log.debug('Set Blower ->', value? 'On': 'Off', this.platform.status());
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
    this.platform.log.debug('Get Blower','<-',isOn?'On':'Off', this.platform.status());
    
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      callback(null, isOn);
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   * It is possible that the Spa rejects this change, if the user is trying to turn the blower off, if it
   * is during a filter cycle. In that case the 'updateCharacteristics' callback below will end up
   * being called and that will discover the correct new value.  
   */
  setRotationSpeed(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    // value is 0-100, and we want to convert that to [0,numSpeedSettings]
    const speed = Math.round(((value as number)*this.numSpeedSettings)/100.0);
    // Store this immediately.
    this.states.lastNonZeroSpeed = speed;
    this.platform.log.debug('Set Blower Speed ->', value, 'which is', 
      this.platform.spa.getSpeedAsString(this.numSpeedSettings, speed) , this.platform.status());
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
    // As above we convert the speed of 0-3 to a value of 0-100, taking account
    // of the number of speeds the blower has
    const value = (100.0*speed)/this.numSpeedSettings;
    this.platform.log.debug('Get Blower Speed <-', value, 'which is', 
      this.platform.spa.getSpeedAsString(this.numSpeedSettings, speed), this.platform.status());
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      callback(null, value);
    }
  }

  spaConfigurationKnown() {
    if (this.platform.spa.getBlowerSpeed() == undefined) {
      // The blower doesn't exist.
      this.platform.log.warn("Nonexistent blower accessory declared.");
      return;
    }
    this.numSpeedSettings = this.platform.spa.getBlowerSpeedRange();
    this.platform.log.info("Blower has", this.numSpeedSettings, "speeds.");
    // Tell Home about the minimum step size to use.
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({minStep: (100.0/this.numSpeedSettings)});
  }

  // If Spa state has changed, for example using manual controls on the spa, then we must update Homekit.
  updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      this.platform.log.debug('Blower updating',this.platform.status());
      this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.platform.connectionProblem);
      this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.platform.connectionProblem);
      return;
    }
    const speed = this.getSpeed();
    const isOn = speed != 0;
    const speedValue = (100.0*speed)/this.numSpeedSettings;
    
    this.platform.log.debug('Blower updating to',isOn ? 'On' : 'Off','and',speed, 'which is', 
      this.platform.spa.getSpeedAsString(this.numSpeedSettings, speed));
    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(isOn);
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(speedValue);
  }

  private getSpeed() {
    // return 0-3
    return this.platform.spa.getBlowerSpeed();
  }

  private scheduleId : any = undefined;

  /** 
   * When the blower is turned on, we receive both an on setting (which triggers setting
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
    this.platform.log.debug('Blower actually setting speed to',speed,'which is', 
      this.platform.spa.getSpeedAsString(this.numSpeedSettings, speed), this.platform.status());
    this.platform.spa.setBlowerSpeed(speed);
    if (speed != 0) {
      this.states.lastNonZeroSpeed = speed;
    }
  }
}
