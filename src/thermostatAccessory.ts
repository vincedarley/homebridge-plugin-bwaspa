import { CharacteristicEventTypes, Characteristic } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';

/**
 * A thermostat temperature control for the Spa.
 */
export class ThermostatAccessory {
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

    // get the Thermostat service if it exists, otherwise create a new Thermostat service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Thermostat) ?? this.accessory.addService(this.platform.Service.Thermostat);

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.TemperatureSensor, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Thermostat

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on(CharacteristicEventTypes.GET, this.getCurrentTemperature.bind(this));               // GET - bind to the `getOn` method below
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .on(CharacteristicEventTypes.SET, this.setTargetTemperature.bind(this))
      .setProps({
        minValue: 20.0,
        maxValue: 40.0,
        minStep: 0.5
      })
      .on(CharacteristicEventTypes.GET, this.getTargetTemperature.bind(this));               // GET - bind to the `getOn` method below
    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .on(CharacteristicEventTypes.GET, this.getTemperatureDisplayUnits.bind(this)); 
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .on(CharacteristicEventTypes.GET, this.getHeatingCoolingState.bind(this)); 
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .on(CharacteristicEventTypes.SET, this.setTargetHeatingCoolingState.bind(this))                // SET - bind to the `setOn` method below
      .on(CharacteristicEventTypes.GET, this.getTargetHeatingCoolingState.bind(this));               // GET - bind to the `getOn` method below
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
  getCurrentTemperature(callback: CharacteristicGetCallback) {

    const temperature = this.platform.spa.getCurrentTemp();

    this.platform.log.debug('Get Current Temperature Characteristic ->', temperature);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, temperature);
  }

  getTemperatureDisplayUnits(callback: CharacteristicGetCallback) {

    const cOrF = this.platform.spa.getTempIsCorF();
    const units = cOrF == "Fahrenheit" ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS;

    this.platform.log.debug('Get Temperature Display Units Characteristic ->', units);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, units);
  }

  getHeatingCoolingState(callback: CharacteristicGetCallback) {

    const heating = this.platform.spa.getIsHeatingNow();

    this.platform.log.debug('Get Heating Cooling State Characteristic ->', heating);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, heating);
  }

  getTargetHeatingCoolingState(callback: CharacteristicGetCallback) {

    const mode = this.platform.spa.getTempRangeIsHigh();
    const heating = mode ? Characteristic.TargetHeatingCoolingState.HEAT : Characteristic.TargetHeatingCoolingState.COOL;

    this.platform.log.debug('Get Target Heating Cooling State Characteristic ->', heating);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, heating);
  }

  setTargetHeatingCoolingState(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    const heating = (value == Characteristic.TargetHeatingCoolingState.HEAT);
    this.platform.spa.setTempRangeIsHigh(heating);
    this.platform.log.debug('Set Target Heating Cooling State Characteristic ->', heating);

    // you must call the callback function
    callback(null);
  }

  getTargetTemperature(callback: CharacteristicGetCallback) {

    const temperature = this.platform.spa.getTargetTemp();

    this.platform.log.debug('Get Target Temperature Characteristic ->', temperature);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, temperature);
  }

  setTargetTemperature(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    this.platform.spa.setTargetTemperature(value as number);
    this.platform.log.debug('Set Target Temperature Characteristic ->', value);

    // you must call the callback function
    callback(null);
  }

}
