import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';

/**
 * A read-only temperature sensor for the Spa.
 */
export class TemperatureAccessory {
  private service: Service;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Balboa')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, VERSION);

    // get the TemperatureSensor service if it exists, otherwise create a new TemperatureSensor service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.TemperatureSensor) ?? this.accessory.addService(this.platform.Service.TemperatureSensor);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/TemperatureSensor

    // register handlers for the Get Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on(CharacteristicEventTypes.GET, this.get.bind(this));               // GET - bind to the `getOn` method below

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
   * this.service.updateCharacteristic(this.platform.Characteristic.get, true)
   */
  get(callback: CharacteristicGetCallback) {
    const temperature = this.platform.spa.getCurrentTemp();

    // Seems as if Homekit interprets null as something simply to be ignored, hence Homekit
    // just uses the previous known value.
    const val = (temperature == undefined ? null : temperature);
    this.platform.log.debug('Get Temperature <-', val, this.platform.status());

    if (!this.platform.spa.hasGoodSpaConnection()) {
      callback(this.platform.connectionProblem);
    } else {
      callback(null, val);
    }
  }

  // If Spa state has changed, for example using manual controls on the spa, then we must update Homekit.
  updateCharacteristics() {
    if (!this.platform.spa.hasGoodSpaConnection()) {
      this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(this.platform.connectionProblem);
      return;
    }

    const temperature = this.platform.spa.getCurrentTemp();
    const val = (temperature == undefined ? null : temperature!);
    this.platform.log.debug('Temperature updating to',val);
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(val);
  }

}
