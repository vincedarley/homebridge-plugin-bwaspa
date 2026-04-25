import { APIEvent } from 'homebridge';
import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { PumpAccessory } from './homekit/pumpAccessory';
import { LightsAccessory } from './homekit/lightsAccessory';
import { TemperatureAccessory } from './homekit/temperatureAccessory';
import { ThermostatAccessory } from './homekit/thermostatAccessory';
import { WaterFlowProblemAccessory } from './homekit/waterFlowProblemAccessory';
import { HoldSwitchAccessory } from './homekit/holdSwitchAccessory';
import { LockAccessory } from './homekit/lockAccessory';
import { HeatingReadySwitchAccessory } from './homekit/heatingReadySwitchAccessory';
import { BlowerAccessory } from './homekit/blowerAccessory';
import { OtherAccessory } from './homekit/otherAccessory';
import { MatterPumpAccessory } from './matter/matterPumpAccessory';
import { MatterLightsAccessory } from './matter/matterLightsAccessory';
import { MatterSwitchAccessory } from './matter/matterSwitchAccessory';
import { MatterTemperatureAccessory } from './matter/matterTemperatureAccessory';
import { MatterFlowAccessory } from './matter/matterFlowAccessory';
import { MatterLockAccessory } from './matter/matterLockAccessory';
import { MatterBlowerAccessory } from './matter/matterBlowerAccessory';
import { MatterThermostatAccessory } from './matter/matterThermostatAccessory';
import { SpaClient } from './spaClient';
import { DummySpaClient } from './dummySpaClient';
import type { SpaController } from './spaController';
import { discoverSpas } from './discovery';

/**
 * SpaHomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SpaHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service;
  public readonly Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly matterAccessories: Map<string, any> = new Map();
  spa : (SpaController | undefined);
  devices : any[];
  deviceObjects : any[];
  matterDeviceObjects : any[];
  name : string;

  connectionProblem = new Error('Connecting...');

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    if (!config) {
      log.warn('No configuration found for %s', PLUGIN_NAME);
    }

    this.log.debug('Finished initializing platform:', this.config.name);
    this.devices = config.devices || [];
    this.deviceObjects = new Array();
    this.matterDeviceObjects = new Array();
    this.spa = undefined;

    // If the user has specified the model name, use that.
    this.name = config.name!;
    
    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });

    if (this.shouldUseDummySpaClient()) {
      this.log.warn('Debug dummy spa mode is enabled. Using virtual in-memory spa state.');
      this.haveAddressOfSpa(config.devMode, 'dummy-spa');
    } else if (config.host && config.host.length > 0) {
      // The user provided the IP address in the config
      this.haveAddressOfSpa(config.devMode, config.host);
    } else {
      // We'll go out and find it automatically
      discoverSpas(log, this.haveAddressOfSpa.bind(this, config.devMode));
    }
    
    this.api.on(APIEvent.SHUTDOWN, () => {
      log.debug('Closing down homebridge - closing our connection to the Spa...');
      if (this.spa) {
        this.spa.shutdownSpaConnection();
      }
    });
  }

  haveAddressOfSpa(devMode: boolean, ipAddress: string) {
    if (this.spa) {
      this.log.error('Already have a spa set up. If you wish to control two or more Spas, please file a bug report.');
      return;
    }

    const SpaClientCtor = this.shouldUseDummySpaClient() ? DummySpaClient : SpaClient;
    this.spa = new SpaClientCtor(
      this.log,
      ipAddress,
      this.spaConfigurationKnown.bind(this),
      this.updateStateOfAccessories.bind(this),
      this.executeAllRecordedActions.bind(this),
      devMode,
    );
  }

  private shouldUseDummySpaClient() {
    return Boolean((this.config as any).debugUseDummySpa);
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Restoring homekit accessory from cache:', accessory.displayName);

    this.makeAccessory(accessory);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  configureMatterAccessory(accessory: any) {
    this.log.info('Restoring matter accessory from cache:', accessory.displayName);
    this.matterAccessories.set(accessory.UUID, accessory);
    // Controllers are created in makeMatterDevice when discoverDevices runs.
  }

  /**
   * Called once we have received a message from the spa containing the
   * accurate configuration of number of pumps (and their speed ranges), 
   * lights, etc.
   */
  spaConfigurationKnown() {
    if (this.config.autoCreateAccessories) {
      // Make sure we create all devices before we try to accurately
      // configure them all.
      this.discoverDevices();
    }
    this.log.debug('Spa configuration known - informing each accessory');
    this.deviceObjects.forEach(deviceObject => {
      deviceObject.spaConfigurationKnown();
    });
    this.matterDeviceObjects.forEach(deviceObject => {
      deviceObject.spaConfigurationKnown();
    });
  }

  private scheduleId : any = undefined;

  /**
   * This is a callback which is triggered when the Spa code discovers that something has changed in
   * the spa state, where that change might have happened outside of Home. In such a case we need to
   * make sure all accessories are resynced. This resync operation is lightweight (no spa communication
   * needed) and fast. It may lead to Home's knowledge of the state of each accessory changing.
   * 
   * The only challenge is that this call might be triggered while changes are already
   * being sent to the spa, so we want to wait for any changes to play out before
   * checking the spa's state and updating everything.
   */
  updateStateOfAccessories() {
    if (this.scheduleId) {
      clearTimeout(this.scheduleId);
      this.scheduleId = undefined;
    }
    // Allow 250ms leeway for another state change event.
    this.scheduleId = setTimeout(() => {
      this.reallyUpdateStateOfAccessories();
      this.scheduleId = undefined;
    }, 250);
  }

  private reallyUpdateStateOfAccessories() {
    this.log.debug('State of something changed - tell HomeKit about it.');
    // For the moment, we simply loop through every device updating homekit.
    // At least theoretically better if we could just do the ones we know have changed.
    this.deviceObjects.forEach(deviceObject => {
      deviceObject.updateCharacteristics();
    });
    this.matterDeviceObjects.forEach(deviceObject => {
      Promise.resolve(deviceObject.updateCharacteristics())
        .catch((error: unknown) => {
          this.log.warn('Could not push matter state update:', error);

          const message = `${(error as any)?.message ?? error}`.toLowerCase();
          if (message.includes('not found or not registered')) {
            const uuid = (deviceObject as any)?.UUID;
            if (uuid) {
              this.log.warn('Matter accessory appears unregistered; suppressing further updates for UUID', uuid);
              this.matterAccessories.delete(uuid);
              this.removeMatterDeviceObjectsForUuid(uuid);
            }
          }
        });
    });
  }

  status() {
    if (this.isCurrentlyConnected()) {
      return '(connected)';
    } else {
      return '(not currently connected)';
    }
  }

  isCurrentlyConnected() {
    return this.spa ? this.spa.hasGoodSpaConnection() : false;
  }

  recordedActions : CallableFunction[] = [];
  
  recordAction(func: CallableFunction) {
    this.log.info('Recording action for later:', func);
    this.recordedActions.push(func);
  }

  executeAllRecordedActions() {
    const loggingCallback = (foo: any) => {
      this.log.info('Replayed action called back with:', foo);
    };
    while (this.isCurrentlyConnected() && this.recordedActions.length > 0) {
      const func = this.recordedActions.shift()!;
      this.log.info('Replaying an action:', func);
      func(loggingCallback);
    }
  }

  /**
   * We get all accessories either from the spa itself or from the config.json file.
    */
  discoverDevices() {
    if (this.config.autoCreateAccessories && this.spa && this.spa.accurateConfigReadFromSpa) {
      this.log.info('Autocreating accessories...');
      if (this.spa!.getIsLightOn(1) !== undefined) {
        this.makeDevice('Spa Lights 1', 'Lights 1');
      }
      if (this.spa!.getIsLightOn(2) !== undefined) {
        this.makeDevice('Spa Lights 2', 'Lights 2');
      }
      for (let pump = 1; pump <=6; pump++) {
        if (this.spa!.getPumpSpeedRange(pump) !== 0) {
          this.makeDevice('Spa Pump '+pump, 'Pump '+pump);
        }
      }
      if (this.spa!.getPumpSpeedRange(0) !== 0) {
        this.makeDevice('Spa Circulation Pump', 'Circulation Pump');
      }
      this.makeDevice('Spa Temperature Sensor', 'Temperature Sensor');
      this.makeDevice('Spa Thermostat', 'Thermostat');
      this.makeDevice('Primary Thermostat', 'Primary Thermostat');
      this.makeDevice('Eco Thermostat', 'Eco Thermostat');
      this.makeDevice('Spa Eco Mode', 'Eco Mode');
      this.makeDevice('Spa Flow Error', 'Water Flow Problem Sensor');
      this.makeDevice('Spa Flow Low', 'Water Flow Low Sensor');
      this.makeDevice('Hold Spa', 'Hold Switch');
      this.makeDevice('Spa Settings', 'Spa Settings');
      this.makeDevice('Spa Panel', 'Spa Panel');
      this.makeDevice('Spa Heat Mode Ready', 'Spa Heat Mode Ready');
      if (this.spa!.getBlowerSpeedRange() !== 0) {
        this.makeDevice('Spa Blower', 'Blower');
      }
      if (this.spa!.getIsMisterOn() !== undefined) {
        this.makeDevice('Spa Mister', 'Mister');
      }
      if (this.spa!.getIsAuxOn(1) !== undefined) {
        this.makeDevice('Spa Aux 1', 'Aux 1');
      }
      if (this.spa!.getIsAuxOn(2) !== undefined) {
        this.makeDevice('Spa Aux 2', 'Aux 2');
      }
    }
    for (const device of this.devices) {
      if (!device.deviceType) {
        this.log.warn('Device Type Missing');
      } else if (!device.name) {
        this.log.warn('Device Name Missing for type:', device.deviceType);
      } else {
        this.makeDevice(device.name, device.deviceType);
      }
    }
  }

  /**
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  private makeDevice(name: string, deviceType: string) {
    void this.makeMatterDevice(name, deviceType).catch((error) => {
      this.log.error('Unhandled Matter setup error for', name, 'of type', deviceType, error);
    });

    // These device types are Matter-only and should not be registered as HomeKit accessories.
    if (deviceType === 'Water Flow Low Sensor' 
        || deviceType === 'Eco Mode'
        || deviceType === 'Primary Thermostat'
        || deviceType === 'Eco Thermostat') {
      return;
    }

    const device = { name, deviceType };

    // generate a unique id for the accessory this should be generated from
    // something globally unique, but constant, for example, the device serial
    // number or MAC address
    const uuid = this.api.hap.uuid.generate(deviceType);

    // check that the device has not already been registered by checking the
    // cached devices we stored in the `configureAccessory` method above
    if (!this.accessories.find(accessory => accessory.UUID === uuid)) {
      this.log.info('Registering new accessory:', name, 'of type', deviceType);
      // create a new accessory
      const accessory = new this.api.platformAccessory(name, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;

      this.makeAccessory(accessory);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);

      // push into accessory cache
      this.accessories.push(accessory);

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      // If we do this, we should also remove them from the deviceObjects array.
    }
  }

  private async makeMatterDevice(name: string, deviceType: string) {
    const matter = (this.api as any).matter;
    if (!matter) {
      return;
    }

    if (!this.isMatterEnabledDeviceType(deviceType)) {
      return;
    }

    const uuid = matter.uuid.generate(deviceType);
    // Guard: prevent double-registration if discoverDevices is called more than once.
    if (this.matterDeviceObjects.some((d: any) => d.UUID === uuid)) {
      return;
    }

    const controller = this.createMatterController(name, deviceType);
    if (!controller) {
      return;
    }

    if (!this.matterAccessories.has(uuid)) {
      this.log.info('Registering new matter accessory:', name, 'of type', deviceType);
    }

    try {
      await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [controller]);
      this.matterAccessories.set(uuid, controller);
      this.matterDeviceObjects.push(controller);
      
      // If spa configuration was already received before this accessory registered,
      // notify the accessory after a delay to allow Matter to complete endpoint setup.
      if (this.spa?.accurateConfigReadFromSpa) {
        setTimeout(() => {
          controller.spaConfigurationKnown();
        }, 1000);
      }
    } catch (error) {
      this.log.warn('Could not register matter accessory', name, 'because:', error);
      this.matterAccessories.delete(uuid);
    }
  }

  private removeMatterDeviceObjectsForUuid(uuid: string) {
    this.matterDeviceObjects = this.matterDeviceObjects.filter((deviceObject: any) => {
      return deviceObject?.UUID !== uuid;
    });
  }

  private isMatterEnabledDeviceType(deviceType: string) {
    return this.isMatterPumpType(deviceType)
      || this.isMatterBlowerType(deviceType)
      || this.isMatterLightType(deviceType)
      || this.isMatterSwitchType(deviceType)
      || this.isMatterLockType(deviceType)
      || this.isMatterThermostatType(deviceType)
      || deviceType === 'Temperature Sensor'
      || deviceType === 'Water Flow Problem Sensor'
      || deviceType === 'Water Flow Low Sensor';
  }

  private isMatterPumpType(deviceType: string) {
    return deviceType === 'Circulation Pump' || /^Pump [1-6]$/.test(deviceType);
  }

  private isMatterBlowerType(deviceType: string) {
    return deviceType === 'Blower';
  }

  private isMatterLightType(deviceType: string) {
    return deviceType === 'Lights 1' || deviceType === 'Lights 2';
  }

  private isMatterSwitchType(deviceType: string) {
    return deviceType === 'Hold Switch'
      || deviceType === 'Spa Heat Mode Ready'
      || deviceType === 'Eco Mode'
      || deviceType === 'Mister'
      || deviceType === 'Aux 1'
      || deviceType === 'Aux 2';
  }

  private isMatterLockType(deviceType: string) {
    return deviceType === 'Spa Settings' || deviceType === 'Spa Panel';
  }

  private isMatterThermostatType(deviceType: string) {
    return deviceType === 'Primary Thermostat' || deviceType === 'Eco Thermostat';
  }

  private createMatterController(name: string, deviceType: string): any {
    const device = { name, deviceType };
    
    switch (deviceType) {
      case 'Circulation Pump':
        return new MatterPumpAccessory(this, device, 0);
      case 'Pump 1':
        return new MatterPumpAccessory(this, device, 1);
      case 'Pump 2':
        return new MatterPumpAccessory(this, device, 2);
      case 'Pump 3':
        return new MatterPumpAccessory(this, device, 3);
      case 'Pump 4':
        return new MatterPumpAccessory(this, device, 4);
      case 'Pump 5':
        return new MatterPumpAccessory(this, device, 5);
      case 'Pump 6':
        return new MatterPumpAccessory(this, device, 6);
      case 'Blower':
        return new MatterBlowerAccessory(this, device);
      case 'Lights 1':
        return new MatterLightsAccessory(this, device, 1);
      case 'Lights 2':
        return new MatterLightsAccessory(this, device, 2);
      case 'Hold Switch':
        return new MatterSwitchAccessory(this, device, 'hold');
      case 'Spa Heat Mode Ready':
        return new MatterSwitchAccessory(this, device, 'heatingReady');
      case 'Eco Mode':
        return new MatterSwitchAccessory(this, device, 'ecoMode');
      case 'Mister':
        return new MatterSwitchAccessory(this, device, 'mister');
      case 'Aux 1':
        return new MatterSwitchAccessory(this, device, 'aux1');
      case 'Aux 2':
        return new MatterSwitchAccessory(this, device, 'aux2');
      case 'Spa Settings':
        return new MatterLockAccessory(this, device, false);
      case 'Spa Panel':
        return new MatterLockAccessory(this, device, true);
      case 'Primary Thermostat':
        return new MatterThermostatAccessory(this, device, 'primary');
      case 'Eco Thermostat':
        return new MatterThermostatAccessory(this, device, 'eco');
      case 'Temperature Sensor':
        return new MatterTemperatureAccessory(this, device);
      case 'Water Flow Problem Sensor':
        return new MatterFlowAccessory(this, device, 'failed');
      case 'Water Flow Low Sensor':
        return new MatterFlowAccessory(this, device, 'low');
      default:
        return undefined;
    }
  }

  /*
   * Here we make our Spa accessory to fit with the generic platformAccessory provided, which has
   * relevant details in 'device' 
   */
  makeAccessory(accessory: PlatformAccessory) {
    const deviceType = accessory.context.device.deviceType;
    switch (deviceType) {
      case 'Circulation Pump': {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 0));
        break;
      }
      case 'Pump 1': {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 1));
        break;
      }
      case 'Pump 2': {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 2));
        break;
      }
      case 'Pump 3': {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 3));
        break;
      }
      case 'Pump 4': {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 4));
        break;
      }
      case 'Pump 5': {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 5));
        break;
      }
      case 'Pump 6': {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 6));
        break;
      }
      case 'Lights 1': {
        this.deviceObjects.push(new LightsAccessory(this, accessory, 1));
        break;
      }
      case 'Lights 2': {
        this.deviceObjects.push(new LightsAccessory(this, accessory, 2));
        break;
      }
      case 'Temperature Sensor': {
        this.deviceObjects.push(new TemperatureAccessory(this, accessory));
        break;
      }
      case 'Thermostat': {
        this.deviceObjects.push(new ThermostatAccessory(this, accessory));
        break;
      }
      case 'Water Flow Problem Sensor': {
        this.deviceObjects.push(new WaterFlowProblemAccessory(this, accessory));
        break;
      }
      case 'Hold Switch': {
        this.deviceObjects.push(new HoldSwitchAccessory(this, accessory));
        break;
      }
      case 'Spa Settings': {
        this.deviceObjects.push(new LockAccessory(this, accessory, false));
        break;
      }
      case 'Spa Panel': {
        this.deviceObjects.push(new LockAccessory(this, accessory, true));
        break;
      }
      case 'Spa Heat Mode Ready': {
        this.deviceObjects.push(new HeatingReadySwitchAccessory(this, accessory));
        break;
      }
      case 'Blower': {
        this.deviceObjects.push(new BlowerAccessory(this, accessory));
        break;
      }
      case 'Mister': {
        this.deviceObjects.push(new OtherAccessory(this, accessory, 0));
        break;
      }
      case 'Aux 1': {
        this.deviceObjects.push(new OtherAccessory(this, accessory, 1));
        break;
      }
      case 'Aux 2': {
        this.deviceObjects.push(new OtherAccessory(this, accessory, 2));
        break;
      }
      default: {
        this.log.warn('Unknown accessory type', deviceType);
      }
    }

  }
}
