import { APIEvent } from 'homebridge';
import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { PumpAccessory } from './pumpAccessory';
import { LightsAccessory } from './lightsAccessory';
import { TemperatureAccessory } from './temperatureAccessory';
import { ThermostatAccessory } from './thermostatAccessory';
import { WaterFlowProblemAccessory } from './waterFlowProblemAccessory';
import { HoldSwitchAccessory } from './holdSwitchAccessory';
import { BlowerAccessory } from './blowerAccessory';
import { OtherAccessory } from './otherAccessory';
import { SpaClient } from './spaClient';
import { discoverSpas } from './discovery';

/**
 * SpaHomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SpaHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service = this.api.hap.Service;
  public readonly Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  spa : (SpaClient | undefined);
  devices : any[];
  deviceObjects : any[];
  model : string;

  connectionProblem = new Error('Connecting...');

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    if (!config || !Array.isArray(config.devices)) {
      log.warn('No configuration found for %s', PLUGIN_NAME);
    }

    this.log.debug('Finished initializing platform:', this.config.name);
    this.devices = config.devices || [];
    this.deviceObjects = new Array();
    this.spa = undefined;

    // If the user has specified the model name, use that.
    this.model = config.model ? config.model : 'Unknown model';

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });

    if (config.host && config.host.length() > 0) {
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

  haveAddressOfSpa(devMode: boolean, ip: string) {
    // Create and load up our primary client which connects with the spa
    this.spa = new SpaClient(this.log, ip, this.spaConfigurationKnown.bind(this),
      this.updateStateOfAccessories.bind(this), devMode);
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

  /**
   * Called once we have received a message from the spa containing the
   * accurate configuration of number of pumps (and their speed ranges), 
   * lights, etc.
   */
  spaConfigurationKnown() {
    this.log.debug('Spa configuration known - informing each accessory');
    this.deviceObjects.forEach(deviceObject => {
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

  /**
   * We read all accessories from the config.json file.
   * 
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    for (var device of this.devices) {
      if (!device.deviceType) {
        this.log.warn('Device Type Missing')
      } else {
        // generate a unique id for the accessory this should be generated from
        // something globally unique, but constant, for example, the device serial
        // number or MAC address
        const uuid = this.api.hap.uuid.generate(device.deviceType);

        // check that the device has not already been registered by checking the
        // cached devices we stored in the `configureAccessory` method above
        if (!this.accessories.find(accessory => accessory.UUID === uuid)) {
          this.log.info('Registering new accessory:', device.name , 'of type', device.deviceType);
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
    }

  }

  /*
   * Here we make our Spa accessory to fit with the generic platformAccessory provided, which has
   * relevant details in 'device' 
   */
  makeAccessory(accessory: PlatformAccessory) {
    const deviceType = accessory.context.device.deviceType;
    switch (deviceType) {
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
