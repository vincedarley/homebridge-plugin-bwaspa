import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';
import { FLOW_FAILED, FLOW_GOOD } from './spaClient';

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
      .setCharacteristic(this.platform.Characteristic.Model, this.platform.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, VERSION);

    // get the Thermostat service if it exists, otherwise create a new Thermostat service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Thermostat) ?? this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Thermostat

    // register handlers for the required Characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on(CharacteristicEventTypes.GET, this.getCurrentTemperature.bind(this));               
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .on(CharacteristicEventTypes.SET, this.setTargetTemperature.bind(this))
      .on(CharacteristicEventTypes.GET, this.getTargetTemperature.bind(this));               
    this.setTargetTempMinMax();
    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .on(CharacteristicEventTypes.GET, this.getTemperatureDisplayUnits.bind(this)); 
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .on(CharacteristicEventTypes.GET, this.getHeatingState.bind(this)); 
    // Adjust properties to only allow Off and Heat (not Cool or Auto which are irrelevant)
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .on(CharacteristicEventTypes.SET, this.setTargetHeatingState.bind(this)).setProps({
        minValue: 0,
        maxValue: 2,
        validValues: [0,1,2]
      })
      .on(CharacteristicEventTypes.GET, this.getTargetHeatingState.bind(this));
  }
  
    // In "high" mode (the normal mode, which we call "Heat" for this Homekit thermostat), 
    // the target temperature can be between 26.5 and 40 celsius.
    // In "low" mode (useful for holidays or days when we're not using the spa, which we
    // call "Off" for this Homekit thermostat), target can be between 10 and 36 celsius.  
  setTargetTempMinMax() {
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
      minValue: 10.0,
      maxValue: 40.0,
      minStep: 0.5
    });
    // Code below seems not to work with HomeKit to dynamically change the valid range.
    // So we just set the broadest range above and will then have to validate if the user
    // tries to change to illegal values.

    // if (this.platform.spa.getTempRangeIsHigh()) {
    //   this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
    //     minValue: 26.5,
    //     maxValue: 40.0,
    //     minStep: 0.5
    //   });
    // } else {
    //   this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
    //     minValue: 10.0,
    //     maxValue: 36.0,
    //     minStep: 0.5
    //   });
    // }
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
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const temperature = this.platform.spa!.getCurrentTemp();
      // Seems as if Homekit interprets null as something simply to be ignored, hence Homekit
      // just uses the previous known value.
      const val = (temperature == undefined ? null : temperature);
  
      this.platform.log.debug('Get Current Temperature <-', val, this.platform.status());
  
      callback(null, val);
    }
  }

  getTemperatureDisplayUnits(callback: CharacteristicGetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const cOrF = this.platform.spa!.getTempIsCorF();
      const units = (cOrF == "Fahrenheit" 
      ? this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT : this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS);
      this.platform.log.debug('Get Temperature Display Units <-', cOrF, " ", units, this.platform.status());
  
      callback(null, units);
    }    
  }

  getHeatingState(callback: CharacteristicGetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const heating = this.platform.spa!.getIsHeatingNow();
      this.platform.log.debug('Get Heating State <-', heating, this.platform.status());
  
      callback(null, heating ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
        : this.platform.Characteristic.CurrentHeatingCoolingState.OFF);
    }
  }

  getTargetHeatingState(callback: CharacteristicGetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const mode = this.platform.spa!.getTempRangeIsHigh();
      // might want "LOW" or "FAILED" here, rather than just the latter.
      const flowError = (this.platform.spa!.getFlowState() == FLOW_FAILED);
      var result;
      if (flowError) {
        result = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
      } else {
        result = mode ? this.platform.Characteristic.TargetHeatingCoolingState.HEAT 
        : this.platform.Characteristic.TargetHeatingCoolingState.COOL;
      }
      this.platform.log.debug('Get Target Heating State <-', 
      mode ? "HEAT" : "COOL", "Flow error(" + flowError + ")", result, this.platform.status());
  
      callback(null, result);
    }
  }

  setTargetHeatingState(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
      return;
    }
    if (value == this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
      // Check if this makes sense or if we should reject the change.
      if (this.platform.spa!.getFlowState() == FLOW_GOOD) {
        this.platform.log.debug("Spa doesn't allow turned heating off. Reverting.");
        callback(new Error("Spa doesn't allow turned heating off. Reverting."));
        // value = Characteristic.TargetHeatingCoolingState.COOL;
        // this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
        //   .updateValue(Characteristic.TargetHeatingCoolingState.COOL);
        return;
      }
    } else if (this.platform.spa!.getFlowState() == FLOW_FAILED) {
      // Can only be in the "off" state
      callback(new Error("Water flow has failed. Heating off"));
      return;
    }
    // HEAT means "high".  If users chooses "cool" or "off", we treat those as "low"
    const heating = (value == this.platform.Characteristic.TargetHeatingCoolingState.HEAT);
    this.platform.spa!.setTempRangeIsHigh(heating);
    this.platform.log.debug('Set Target Heating State ->', heating ? "HEAT" : "COOL", 
      value, "(and need to adjust valid range)", this.platform.status());
    // Adjust the allowed range
    this.setTargetTempMinMax();
    // We need to change the target temperature (which the Spa adjust automatically when switching
    // from High to Low), else it will take a while for HomeKit to pick that up automatically.
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .updateValue(this.platform.spa!.getTargetTemp());
    callback(null);
  }

  getTargetTemperature(callback: CharacteristicGetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const temperature = this.platform.spa!.getTargetTemp();
      this.platform.log.debug('Get Target Temperature <-', temperature, this.platform.status());
  
      callback(null, temperature);
    }
  }

  setTargetTemperature(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
      return;
    }
    var temp = value as number;
    if (this.platform.spa!.getTempRangeIsHigh()) {
      if (temp < 26.5) {
        temp = 26.5;
        // TODO: This line doesn't actually seem to update homekit.  Unless we can find
        // a way to do this, we'll have to keep the line underneath to reject the change 
        // with an error in the callback.
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .updateValue(temp);
        callback(new Error("Temperature out of bounds [26.5,40.0]"));
        return;
      }
    } else {
      if (temp > 36.0) {
        temp = 36.0;
        // TODO: This line doesn't actually seem to update homekit.  Unless we can find
        // a way to do this, we'll have to keep the line underneath to reject the change 
        // with an error in the callback.
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .updateValue(temp);
        callback(new Error("Temperature out of bounds [10.0,36.0]"));
        return;
      }
    }
    this.platform.spa!.setTargetTemperature(temp);
    this.platform.log.debug('Set Target Temperature ->', temp, 
      " (may be different to", value, ")", this.platform.status());

    callback(null);
  }

  spaConfigurationKnown() {
    // Nothing to do
  }

  // If Spa state has changed, for example using manual controls on the spa, then we must update Homekit.
  updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(this.platform.connectionProblem);
      this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).updateValue(this.platform.connectionProblem);
      this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(this.platform.connectionProblem);
      this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(this.platform.connectionProblem);
      return;
    }
    const mode = this.platform.spa!.getTempRangeIsHigh();
    const heating = this.platform.spa!.getIsHeatingNow();
    const temperature = this.platform.spa!.getCurrentTemp();
    const val = (temperature == undefined ? null : temperature!);

    const targetTemperature = this.platform.spa!.getTargetTemp();
    const flowState = this.platform.spa!.getFlowState();

    this.platform.log.debug('Thermostat updating to: target:',targetTemperature,'(current:',
      val,'), is high:', mode, ', is heating:', heating, ', flow state:', flowState);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(val);
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).updateValue(targetTemperature);
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(
      flowState != FLOW_GOOD ? this.platform.Characteristic.TargetHeatingCoolingState.OFF : 
      (mode ? this.platform.Characteristic.TargetHeatingCoolingState.HEAT : this.platform.Characteristic.TargetHeatingCoolingState.COOL)
    );
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(
      heating ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
      : this.platform.Characteristic.CurrentHeatingCoolingState.OFF);
  }

}
