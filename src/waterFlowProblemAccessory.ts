import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';

/**
 * WaterFlowProblemAccessory
 * 
 * We use a water flow accessory from a LeakSensor to tell us if there's a problem with the
 * water flow in the heating system of the hot tub.
 */
export class WaterFlowProblemAccessory {
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

    // get the LeakSensor service if it exists, otherwise create a new LeakSensor service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.LeakSensor) ?? this.accessory.addService(this.platform.Service.LeakSensor);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/LeakSensor

    this.service.getCharacteristic(this.platform.Characteristic.LeakDetected)
    .on(CharacteristicEventTypes.GET, this.handleLeakDetectedGet.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.StatusFault)
    .on(CharacteristicEventTypes.GET, this.handleFaultDetectedGet.bind(this));

  }

  handleLeakDetectedGet(callback: CharacteristicGetCallback) {
    const flowState = this.platform.spa.getFlowState();
    this.platform.log.debug('Get Flow State <-', flowState);
    callback(null, flowState === "FAILED");
  }

  handleFaultDetectedGet(callback: CharacteristicGetCallback) {
    const flowState = this.platform.spa.getFlowState();
    this.platform.log.debug('Get Flow Fault <-', flowState);
    callback(null, flowState === "LOW");
  }

  // If Spa state has changed, for example using manual controls on the spa, then we must update Homekit.
  updateCharacteristics() {
    const flowState = this.platform.spa.getFlowState();
    this.service.getCharacteristic(this.platform.Characteristic.LeakDetected).updateValue(flowState === "FAILED");
    this.service.getCharacteristic(this.platform.Characteristic.StatusFault).updateValue(flowState === "LOW");
  }

}
