import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';

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
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // get the TemperatureSensor service if it exists, otherwise create a new TemperatureSensor service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.TemperatureSensor) ?? this.accessory.addService(this.platform.Service.TemperatureSensor);

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.TemperatureSensor, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/TemperatureSensor

    // register handlers for the On/Off Characteristic
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

    // implement your own code to check if the device is on
    const temperature = this.platform.spa.get_current_temp();

    this.platform.log.debug('Get Temperature Characteristic ->', temperature);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, temperature);
  }

}
