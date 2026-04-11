import { APIEvent } from 'homebridge';
import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, VERSION } from './settings';
import { PumpAccessory } from './pumpAccessory';
import { LightsAccessory } from './lightsAccessory';
import { TemperatureAccessory } from './temperatureAccessory';
import { ThermostatAccessory } from './thermostatAccessory';
import { WaterFlowProblemAccessory } from './waterFlowProblemAccessory';
import { HoldSwitchAccessory } from './holdSwitchAccessory';
import { LockAccessory } from './lockAccessory';
import { HeatingReadySwitchAccessory } from './heatingReadySwitchAccessory';
import { BlowerAccessory } from './blowerAccessory';
import { OtherAccessory } from './otherAccessory';
import { MatterPumpAccessory } from './matterPumpAccessory';
import { MatterLightsAccessory } from './matterLightsAccessory';
import { MatterSwitchAccessory } from './matterSwitchAccessory';
import { MatterTemperatureAccessory } from './matterTemperatureAccessory';
import { MatterFlowAccessory } from './matterFlowAccessory';
import { MatterLockAccessory } from './matterLockAccessory';
import { MatterBlowerAccessory } from './matterBlowerAccessory';
import { MatterThermostatAccessory } from './matterThermostatAccessory';
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
    this.log.info('Restoring accessory from cache:', accessory.displayName);

    this.makeAccessory(accessory);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  configureMatterAccessory(accessory: any) {
    this.log.info('Restoring matter accessory from cache:', accessory.displayName);
    this.matterAccessories.set(accessory.UUID, accessory);
    try {
      this.makeMatterAccessory(accessory);
    } catch (error) {
      this.log.error('Could not restore cached matter accessory', accessory.displayName, 'because:', error);
      this.matterAccessories.delete(accessory.UUID);
    }
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
    this.log.debug("State of something changed - tell HomeKit about it.");
    // For the moment, we simply loop through every device updating homekit.
    // At least theoretically better if we could just do the ones we know have changed.
    this.deviceObjects.forEach(deviceObject => {
      deviceObject.updateCharacteristics();
    });
    this.matterDeviceObjects.forEach(deviceObject => {
      Promise.resolve(deviceObject.updateCharacteristics())
        .catch((error: unknown) => this.log.warn('Could not push matter state update:', error));
    });
  }

  status() {
    if (this.isCurrentlyConnected()) {
      return "(connected)";
    } else {
      return "(not currently connected)";
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
      if (this.spa!.getIsLightOn(1) != undefined) this.makeDevice({name: 'Spa Lights 1', deviceType: 'Lights 1'});
      if (this.spa!.getIsLightOn(2) != undefined) this.makeDevice({name: 'Spa Lights 2', deviceType: 'Lights 2'});
      for (let pump = 1; pump <=6; pump++) {
        if (this.spa!.getPumpSpeedRange(pump) != 0) this.makeDevice({name: 'Spa Pump '+pump, deviceType: 'Pump '+pump});
      }
      if (this.spa!.getPumpSpeedRange(0) != 0) this.makeDevice({name: 'Spa Circulation Pump', deviceType: 'Circulation Pump'});
      this.makeDevice({name: 'Spa Temperature Sensor', deviceType: 'Temperature Sensor'});
      this.makeDevice({name: 'Spa Thermostat', deviceType: 'Thermostat'});
      this.makeDevice({name: 'Spa Flow', deviceType: 'Water Flow Problem Sensor'});
      this.makeDevice({name: 'Hold Spa', deviceType: 'Hold Switch'});
      this.makeDevice({name: 'Spa Settings', deviceType: 'Spa Settings'});
      this.makeDevice({name: 'Spa Panel', deviceType: 'Spa Panel'});
      this.makeDevice({name: 'Spa Heat Mode Ready', deviceType: 'Spa Heat Mode Ready'});
      if (this.spa!.getBlowerSpeedRange() != 0) this.makeDevice({name: 'Spa Blower', deviceType: 'Blower'});
      if (this.spa!.getIsMisterOn() != undefined) this.makeDevice({name: 'Spa Mister', deviceType: 'Mister'});
      if (this.spa!.getIsAuxOn(1) != undefined) this.makeDevice({name: 'Spa Aux 1', deviceType: 'Aux 1'});
      if (this.spa!.getIsAuxOn(2) != undefined) this.makeDevice({name: 'Spa Aux 2', deviceType: 'Aux 2'});
    }
    for (const device of this.devices) {
      if (!device.deviceType) {
        this.log.warn('Device Type Missing')
      } else {
        this.makeDevice(device);
      }
    }
  }

  /**
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  private makeDevice(device: any) {
    void this.makeMatterDevice(device).catch((error) => {
      this.log.error('Unhandled Matter setup error for', device?.name ?? 'unknown device', 'of type', device?.deviceType ?? 'unknown', error);
    });

    // generate a unique id for the accessory this should be generated from
    // something globally unique, but constant, for example, the device serial
    // number or MAC address
    const uuid = this.api.hap.uuid.generate(device.deviceType);

    // check that the device has not already been registered by checking the
    // cached devices we stored in the `configureAccessory` method above
    if (!this.accessories.find(accessory => accessory.UUID === uuid)) {
      this.log.info('Registering new accessory:', device.name, 'of type', device.deviceType);
      // create a new accessory
      const accessory = new this.api.platformAccessory(device.name, uuid);

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

  private async makeMatterDevice(device: any) {
    const matter = (this.api as any).matter;
    if (!matter) {
      return;
    }

    if (!this.isMatterEnabledDeviceType(device.deviceType)) {
      return;
    }

    const uuid = matter.uuid.generate(device.deviceType);
    const serialNumber = uuid.replace(/-/g, '').slice(0, 32);
    if (this.matterAccessories.has(uuid)) {
      return;
    }

    try {
      this.log.info('Registering new matter accessory:', device.name, 'of type', device.deviceType);
      const accessory = {
        UUID: uuid,
        displayName: device.name,
        serialNumber,
        manufacturer: 'Balboa',
        model: this.name,
        firmwareRevision: VERSION,
        hardwareRevision: VERSION,
        deviceType: this.toMatterDeviceType(device.deviceType),
        context: {
          device,
        },
        clusters: this.defaultMatterClustersFor(device.deviceType, matter),
      };

      this.matterAccessories.set(uuid, accessory);
      this.makeMatterAccessory(accessory);

      try {
        await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      } catch (error) {
        this.log.warn('Could not register matter accessory', device.name, 'because:', error);
        this.matterAccessories.delete(uuid);
      }
    } catch (error) {
      this.log.error('Matter accessory setup failed for', device?.name ?? 'unknown device', 'of type', device?.deviceType ?? 'unknown', error);
      this.matterAccessories.delete(uuid);
    }
  }

  private isMatterEnabledDeviceType(deviceType: string) {
    return this.isMatterPumpType(deviceType)
      || this.isMatterBlowerType(deviceType)
      || this.isMatterLightType(deviceType)
      || this.isMatterSwitchType(deviceType)
      || this.isMatterLockType(deviceType)
      || this.isMatterThermostatType(deviceType)
      || deviceType === 'Temperature Sensor'
      || deviceType === 'Water Flow Problem Sensor';
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
      || deviceType === 'Mister'
      || deviceType === 'Aux 1'
      || deviceType === 'Aux 2';
  }

  private isMatterLockType(deviceType: string) {
    return deviceType === 'Spa Settings' || deviceType === 'Spa Panel';
  }

  private isMatterThermostatType(deviceType: string) {
    return deviceType === 'Thermostat';
  }

  private toMatterDeviceType(deviceType: string) {
    const matter = (this.api as any).matter;
    if (this.isMatterPumpType(deviceType)) {
      return matter.deviceTypes.Pump;
    }
    if (this.isMatterBlowerType(deviceType)) {
      return matter.deviceTypes.Fan || matter.deviceTypes.Pump;
    }
    if (this.isMatterLightType(deviceType)) {
      return matter.deviceTypes.OnOffLight;
    }
    if (this.isMatterSwitchType(deviceType)) {
      return matter.deviceTypes.OnOffSwitch;
    }
    if (this.isMatterLockType(deviceType)) {
      return matter.deviceTypes.DoorLock;
    }
    if (this.isMatterThermostatType(deviceType)) {
      return matter.deviceTypes.Thermostat || matter.deviceTypes.TemperatureSensor;
    }
    if (deviceType === 'Temperature Sensor') {
      return matter.deviceTypes.TemperatureSensor;
    }
    if (deviceType === 'Water Flow Problem Sensor') {
      return matter.deviceTypes.LeakSensor;
    }
    return matter.deviceTypes.OnOffSwitch;
  }

  private defaultMatterClustersFor(deviceType: string, matter: any) {
    if (this.isMatterPumpType(deviceType)) {
      return {
        onOff: {
          onOff: false,
        },
        levelControl: {
          currentLevel: 1,
          minLevel: 1,
          maxLevel: 254,
        },
      };
    }
    if (this.isMatterBlowerType(deviceType)) {
      return {
        onOff: {
          onOff: false,
        },
        levelControl: {
          currentLevel: 1,
          minLevel: 1,
          maxLevel: 254,
        },
        fanControl: {
          fanMode: (matter.types.FanControl?.FanMode?.Off ?? 0),
          fanModeSequence: (matter.types.FanControl?.FanModeSequence?.OffLowMedHigh ?? 5),
        },
      };
    }
    if (this.isMatterLightType(deviceType) || this.isMatterSwitchType(deviceType)) {
      return {
        onOff: {
          onOff: false,
        },
      };
    }
    if (this.isMatterLockType(deviceType)) {
      return {
        doorLock: {
          lockState: (matter.types.DoorLock?.LockState?.Unlocked ?? 2),
          lockType: (matter.types.DoorLock?.LockType?.Other ?? 0),
          operatingMode: (matter.types.DoorLock?.OperatingMode?.Normal ?? 0),
          actuatorEnabled: true,
        },
      };
    }
    if (this.isMatterThermostatType(deviceType)) {
      return {
        thermostat: {
          localTemperature: 2000,
          occupiedHeatingSetpoint: 3200,
          absMinHeatSetpointLimit: 700,
          absMaxHeatSetpointLimit: 4000,
          minHeatSetpointLimit: 1000,
          maxHeatSetpointLimit: 4000,
          systemMode: (matter.types.Thermostat?.SystemMode?.Heat ?? 4),
          controlSequenceOfOperation: (matter.types.Thermostat?.ControlSequenceOfOperation?.HeatingOnly ?? 4),
        },
      };
    }
    if (deviceType === 'Temperature Sensor') {
      return {
        temperatureMeasurement: {
          measuredValue: 2000,
          minMeasuredValue: -5000,
          maxMeasuredValue: 10000,
        },
      };
    }
    if (deviceType === 'Water Flow Problem Sensor') {
      return {
        booleanState: {
          stateValue: false,
        },
      };
    }
    return {};
  }

  private makeMatterAccessory(accessory: any) {
    const deviceType = accessory.context?.device?.deviceType;
    if (!this.isMatterEnabledDeviceType(deviceType)) {
      return;
    }

    if (this.isMatterPumpType(deviceType)) {
      const pumpNumber = (deviceType === 'Circulation Pump') ? 0 : parseInt(deviceType.split(' ')[1], 10);
      this.matterDeviceObjects.push(new MatterPumpAccessory(this, accessory, pumpNumber));
      return;
    }
    if (this.isMatterBlowerType(deviceType)) {
      this.matterDeviceObjects.push(new MatterBlowerAccessory(this, accessory));
      return;
    }
    if (this.isMatterLightType(deviceType)) {
      const lightNumber = parseInt(deviceType.split(' ')[1], 10);
      this.matterDeviceObjects.push(new MatterLightsAccessory(this, accessory, lightNumber));
      return;
    }
    if (this.isMatterSwitchType(deviceType)) {
      const kind = this.matterSwitchKindFor(deviceType);
      if (kind) {
        this.matterDeviceObjects.push(new MatterSwitchAccessory(this, accessory, kind));
      }
      return;
    }
    if (this.isMatterLockType(deviceType)) {
      this.matterDeviceObjects.push(new MatterLockAccessory(this, accessory, deviceType === 'Spa Panel'));
      return;
    }
    if (this.isMatterThermostatType(deviceType)) {
      this.matterDeviceObjects.push(new MatterThermostatAccessory(this, accessory));
      return;
    }
    if (deviceType === 'Temperature Sensor') {
      this.matterDeviceObjects.push(new MatterTemperatureAccessory(this, accessory));
      return;
    }
    if (deviceType === 'Water Flow Problem Sensor') {
      this.matterDeviceObjects.push(new MatterFlowAccessory(this, accessory));
    }
  }

  private matterSwitchKindFor(deviceType: string) {
    switch (deviceType) {
      case 'Hold Switch':
        return 'hold';
      case 'Spa Heat Mode Ready':
        return 'heatingReady';
      case 'Mister':
        return 'mister';
      case 'Aux 1':
        return 'aux1';
      case 'Aux 2':
        return 'aux2';
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
      case "Circulation Pump": {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 0));
        break;
      }
      case "Pump 1": {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 1));
        break;
      }
      case "Pump 2": {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 2));
        break;
      }
      case "Pump 3": {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 3));
        break;
      }
      case "Pump 4": {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 4));
        break;
      }
      case "Pump 5": {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 5));
        break;
      }
      case "Pump 6": {
        this.deviceObjects.push(new PumpAccessory(this, accessory, 6));
        break;
      }
      case "Lights 1": {
        this.deviceObjects.push(new LightsAccessory(this, accessory, 1));
        break;
      }
      case "Lights 2": {
        this.deviceObjects.push(new LightsAccessory(this, accessory, 2));
        break;
      }
      case "Temperature Sensor": {
        this.deviceObjects.push(new TemperatureAccessory(this, accessory));
        break;
      }
      case "Thermostat": {
        this.deviceObjects.push(new ThermostatAccessory(this, accessory));
        break;
      }
      case "Water Flow Problem Sensor": {
        this.deviceObjects.push(new WaterFlowProblemAccessory(this, accessory));
        break;
      }
      case "Hold Switch": {
        this.deviceObjects.push(new HoldSwitchAccessory(this, accessory));
        break;
      }
      case "Spa Settings": {
        this.deviceObjects.push(new LockAccessory(this, accessory, false));
        break;
      }
      case "Spa Panel": {
        this.deviceObjects.push(new LockAccessory(this, accessory, true));
        break;
      }
      case "Spa Heat Mode Ready": {
        this.deviceObjects.push(new HeatingReadySwitchAccessory(this, accessory));
        break;
      }
      case "Blower": {
        this.deviceObjects.push(new BlowerAccessory(this, accessory));
        break;
      }
      case "Mister": {
        this.deviceObjects.push(new OtherAccessory(this, accessory, 0));
        break;
      }
      case "Aux 1": {
        this.deviceObjects.push(new OtherAccessory(this, accessory, 1));
        break;
      }
      case "Aux 2": {
        this.deviceObjects.push(new OtherAccessory(this, accessory, 2));
        break;
      }
      default: {
        this.log.warn('Unknown accessory type', deviceType);
      }
    }

  }
}
