import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';

/**
 * HeatingReadySwitchAccessory
 * 
 * Turn 'Heating Always Ready' mode on ('Ready') or off ('Rest'). 
 */
export class HeatingReadySwitchAccessory {
  private service: Service;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: PlatformAccessory
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Balboa')
      .setCharacteristic(this.platform.Characteristic.Model, this.platform.name)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, VERSION);

    this.service = this.accessory.getService(this.platform.Service.Switch) ?? this.accessory.addService(this.platform.Service.Switch);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Switch

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on(CharacteristicEventTypes.SET, this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on(CharacteristicEventTypes.GET, this.getOn.bind(this));               // GET - bind to the `getOn` method below
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      this.platform.recordAction(this.setOn.bind(this, value));
      callback(this.platform.connectionProblem);
      return;
    }
    // Turn the switch on or off
    const isHeatingAlwaysReady = value as boolean;
    this.platform.spa!.setHeatingModeAlwaysReady(isHeatingAlwaysReady);
    this.platform.log.debug('Set Heating Always Ready On ->', isHeatingAlwaysReady, 
      'which is', (isHeatingAlwaysReady ? 'Ready' : 'Rest'), 'mode');

    callback(null);
  }

  spaConfigurationKnown() {
    // nothing to do
  }

  // If Spa state has changed, for example using manual controls on the spa, then we must update Homekit.
  updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.platform.connectionProblem);
      return;
    }
    const isHeatingAlwaysReady = this.platform.spa!.isHeatingModeAlwaysReady();
    this.platform.log.debug('Heating Always Ready updating to', isHeatingAlwaysReady ? 'On' : 'Off');
    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(isHeatingAlwaysReady);
  }
  
  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getOn(callback: CharacteristicGetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const isHeatingAlwaysReady = this.platform.spa!.isHeatingModeAlwaysReady();
      this.platform.log.debug('Get Heating Always Ready On <-', isHeatingAlwaysReady, this.platform.status());
      callback(null, isHeatingAlwaysReady);
    }
  }

}
