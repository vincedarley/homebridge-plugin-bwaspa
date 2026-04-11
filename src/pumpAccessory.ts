import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';
import { SpaClient } from './spaClient';

/**
 * Control a 1- or 2- speed pump as a homekit "fan". If 3 speed pumps exist,
 * this should also work.
 */
export class PumpAccessory {
  private service: Service;

  /**
   * Remember the last speed so that flipping the pump on/off will use the same 
   * speed as last time.
   */
  lastNonZeroSpeed = 1;

  // Always 1-3
  numSpeedSettings: number;

  // Always either "Pump N", or "Circulation Pump"
  name: string;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly pumpNumber: number // 1-6 as defined by Balboa, 0 for circulation pump
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Balboa')
      .setCharacteristic(this.platform.Characteristic.Model, this.platform.name)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, VERSION);

    // get the Fan service if it exists, otherwise create a new Fan service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Fan) ?? this.accessory.addService(this.platform.Service.Fan);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
    // until it is set automatically
    this.numSpeedSettings = 0;
    this.name = (pumpNumber == 0 ? "Circulation Pump" : "Pump " + pumpNumber);

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
    this.platform.log.debug('Set', this.name, '->', value ? 'On' : 'Off', this.platform.status());
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
      return;
    }
    if (value as boolean) {
      this.scheduleSetSpeed(this.lastNonZeroSpeed);
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
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const isOn = this.getSpeed() != 0;
      this.platform.log.debug('Get', this.name, '<-', isOn ? 'On' : 'Off', this.platform.status());

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
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
      return;
    }
    // value is 0-100, and we want to convert that, to 0-1, 0-2, 0-3 as appropriate.
    const speed = Math.round((value as number) * this.numSpeedSettings / 100.0);
    // Store this immediately.
    this.lastNonZeroSpeed = speed;
    this.platform.log.debug('Set', this.name, 'Speed ->', value, 'which is',
      SpaClient.getSpeedAsString(this.numSpeedSettings, speed), this.platform.status());

    this.scheduleSetSpeed(speed);

    callback(null);
  }

  /**
   * Handle "GET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  getRotationSpeed(callback: CharacteristicSetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const speed = this.getSpeed();
      // As above we convert the speed of 0-n to a value of 0-100, irrespective
      // of the number of speeds the pump has
      const value = (100.0 * speed) / this.numSpeedSettings;
      this.platform.log.debug('Get', this.name, 'Speed <-', value, 'which is',
        SpaClient.getSpeedAsString(this.numSpeedSettings, speed), this.platform.status());
      callback(null, value);
    }
  }

  spaConfigurationKnown() {
    if (this.platform.spa!.getPumpSpeedRange(this.pumpNumber) === 0) {
      // This pump doesn't exist.
      this.platform.log.warn("Nonexistent", this.name, "accessory declared.");
      return;
    }
    this.numSpeedSettings = this.platform.spa!.getPumpSpeedRange(this.pumpNumber);
    this.platform.log.info(this.name, "has", this.numSpeedSettings, "speeds.");
    // Tell Home about the minimum step size to use (e.g. 50% means values of 0, 50%, 100% are ok)
    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minStep: (100.0 / this.numSpeedSettings) });
  }

  // If Spa state has changed, for example using manual controls on the spa, then we must update Homekit.
  updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      this.platform.log.debug(this.name, 'updating', this.platform.status());
      this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.platform.connectionProblem);
      this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.platform.connectionProblem);
      return;
    }
    const speed = this.getSpeed();
    const isOn = speed != 0;
    const speedValue = (100.0 * speed) / this.numSpeedSettings;
    if (this.numSpeedSettings) {
      this.platform.log.debug(this.name, 'updating to', isOn ? 'On' : 'Off', 'and', speed, 'which is',
        SpaClient.getSpeedAsString(this.numSpeedSettings, speed));
      this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(isOn);
      this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(speedValue);
    }
  }

  private getSpeed() {
    // return 0, 1 or 2.
    return this.platform.spa!.getPumpSpeed(this.pumpNumber);
  }

  private scheduleId: any = undefined;

  /** 
   * When the pump is turned on, we receive both an on setting (which triggers setting
   * the speed) and will usually also (depending on the user's actions) also receive 
   * an immediate follow-on setting of the speed as well.  We want to reconcile multiple
   * rapid speed settings to just a single set of the spa to avoid confusion.
   */
  private scheduleSetSpeed(speed: number) {
    const newSpeed = speed;
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
    this.platform.log.debug(this.name, 'actually setting speed to', speed, 'which is',
      SpaClient.getSpeedAsString(this.numSpeedSettings, speed), this.platform.status());
    this.platform.spa!.setPumpSpeed(this.pumpNumber, speed);
    if (speed != 0) {
      this.lastNonZeroSpeed = speed;
    }
  }
}
