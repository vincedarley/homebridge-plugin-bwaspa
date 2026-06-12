import type { EndpointType, MatterAccessory } from 'homebridge';
import { VERSION } from '../settings';
import type { SpaHomebridgePlatform } from '../platform';
import { MatterPumpAccessory } from './matterPumpAccessory';
import { MatterBlowerAccessory } from './matterBlowerAccessory';
import { MatterLightsAccessory } from './matterLightsAccessory';
import { MatterSwitchAccessory } from './matterSwitchAccessory';
import { MatterLockAccessory } from './matterLockAccessory';
import { MatterThermostatAccessory } from './matterThermostatAccessory';
import { MatterTemperatureAccessory } from './matterTemperatureAccessory';
import { MatterFlowAccessory } from './matterFlowAccessory';
import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';

type EndpointPart = NonNullable<MatterAccessory['parts']>[number];

type ComposedPartController = {
  id: string;
  controller: BaseMatterSpaAccessory;
};

export class MatterComposedSpaAccessory implements MatterAccessory {
  public readonly UUID: string;
  public readonly displayName: string;
  public readonly deviceType: EndpointType;
  public readonly serialNumber: string;
  public readonly manufacturer = 'Balboa';
  public readonly model: string;
  public readonly firmwareRevision: string;
  public readonly hardwareRevision: string;
  public readonly context: Record<string, unknown>;
  public readonly parts: EndpointPart[];

  private readonly matter: any;
  private readonly partControllers: ComposedPartController[] = [];

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
  ) {
    this.matter = (platform.api as any).matter;
    this.UUID = this.matter.uuid.generate(device.deviceType);
    this.serialNumber = this.UUID.replace(/-/g, '').slice(0, 32);
    this.displayName = device.name;
    this.deviceType = this.matter.deviceTypes.BridgedNode;
    this.model = platform.name;
    this.firmwareRevision = VERSION;
    this.hardwareRevision = VERSION;
    this.context = { device };
    this.parts = this.buildParts();
  }

  spaConfigurationKnown() {
    for (const { id, controller } of this.partControllers) {
      try {
        controller.spaConfigurationKnown();
      } catch (error) {
        this.platform.log.warn('Composed part spaConfigurationKnown failed for', id, 'because:', error);
      }
    }

    void this.updateCharacteristics().catch((error: unknown) => {
      this.platform.log.warn('Could not set initial composed matter state for', this.displayName, 'because:', error);
    });
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }

    for (const { id, controller } of this.partControllers) {
      try {
        await controller.updateCharacteristics();
      } catch (error) {
        this.platform.log.warn('Composed part update failed for', id, 'because:', error);
      }
    }
  }

  private buildParts() {
    const parts: EndpointPart[] = [];

    this.addLightParts(parts);
    this.addPumpParts(parts);
    this.addBlowerPart(parts);
    this.addTemperaturePart(parts);
    this.addThermostatParts(parts);
    this.addFlowParts(parts);
    this.addSwitchParts(parts);
    this.addLockParts(parts);

    return parts;
  }

  private addLightParts(parts: EndpointPart[]) {
    for (const lightNumber of [1, 2]) {
      if (this.platform.spa!.getIsLightOn(lightNumber) === undefined) {
        continue;
      }

      const id = `light-${lightNumber}`;
      const controller = new MatterLightsAccessory(
        this.platform,
        { name: `Spa Light ${lightNumber}`, deviceType: `Lights ${lightNumber}` },
        lightNumber,
      );
      this.registerPart(parts, id, controller);
    }
  }

  private addPumpParts(parts: EndpointPart[]) {
    const candidatePumps = [0, 1, 2, 3, 4, 5, 6];
    for (const pumpNumber of candidatePumps) {
      const maxSpeed = this.platform.spa!.getPumpSpeedRange(pumpNumber);
      if (maxSpeed === 0) {
        continue;
      }

      const id = `pump-${pumpNumber}`;
      const deviceType = pumpNumber === 0 ? 'Circulation Pump' : `Pump ${pumpNumber}`;
      const name = pumpNumber === 0 ? 'Spa Circulation Pump' : `Spa Pump ${pumpNumber}`;
      const controller = new MatterPumpAccessory(this.platform, { name, deviceType }, pumpNumber);
      this.registerPart(parts, id, controller);
    }
  }

  private addBlowerPart(parts: EndpointPart[]) {
    if (this.platform.spa!.getBlowerSpeedRange() === 0) {
      return;
    }

    const controller = new MatterBlowerAccessory(this.platform, { name: 'Spa Blower', deviceType: 'Blower' });
    this.registerPart(parts, 'blower', controller);
  }

  private addTemperaturePart(parts: EndpointPart[]) {
    const controller = new MatterTemperatureAccessory(this.platform, {
      name: 'Spa Temperature Sensor',
      deviceType: 'Temperature Sensor',
    });
    this.registerPart(parts, 'temperature', controller);
  }

  private addThermostatParts(parts: EndpointPart[]) {
    // HomebridgeThermostatServer inherits Presets from its internal base class.
    // The presetTypes attribute has a constraint of 1–7 entries, so we provide
    // one minimal entry to satisfy state validation during endpoint initialization.
    // We do not use presets functionally; this entry is required by the cluster schema.
    const minimalPresetTypes = [{ presetScenario: 1, numberOfPresets: 1, presetTypeFeatures: {} }];

    for (const [mode, id, name] of [
      ['primary', 'thermostat-primary', 'Primary Thermostat'],
      ['eco', 'thermostat-eco', 'Eco Thermostat'],
    ] as const) {
      const controller = new MatterThermostatAccessory(
        this.platform,
        { name, deviceType: name },
        mode,
      );
      // Inject presetTypes into the thermostat cluster state before registering the part.
      (controller.clusters as any).thermostat = {
        ...(controller.clusters as any).thermostat,
        presetTypes: minimalPresetTypes,
      };
      this.registerPart(parts, id, controller);
    }
  }

  private addFlowParts(parts: EndpointPart[]) {
    const failedController = new MatterFlowAccessory(this.platform, {
      name: 'Spa Flow Error',
      deviceType: 'Water Flow Problem Sensor',
    }, 'failed');
    this.registerPart(parts, 'flow-failed', failedController);

    const lowController = new MatterFlowAccessory(this.platform, {
      name: 'Spa Flow Low',
      deviceType: 'Water Flow Low Sensor',
    }, 'low');
    this.registerPart(parts, 'flow-low', lowController);
  }

  private addSwitchParts(parts: EndpointPart[]) {
    this.registerPart(
      parts,
      'switch-hold',
      new MatterSwitchAccessory(this.platform, { name: 'Hold Spa', deviceType: 'Hold Switch' }, 'hold'),
    );

    this.registerPart(
      parts,
      'switch-heating-ready',
      new MatterSwitchAccessory(
        this.platform,
        { name: 'Spa Heat Mode Ready', deviceType: 'Spa Heat Mode Ready' },
        'heatingReady',
      ),
    );

    this.registerPart(
      parts,
      'switch-eco-mode',
      new MatterSwitchAccessory(this.platform, { name: 'Spa Eco Mode', deviceType: 'Eco Mode' }, 'ecoMode'),
    );

    if (this.platform.spa!.getIsMisterOn() !== undefined) {
      this.registerPart(
        parts,
        'switch-mister',
        new MatterSwitchAccessory(this.platform, { name: 'Spa Mister', deviceType: 'Mister' }, 'mister'),
      );
    }

    if (this.platform.spa!.getIsAuxOn(1) !== undefined) {
      this.registerPart(
        parts,
        'switch-aux-1',
        new MatterSwitchAccessory(this.platform, { name: 'Spa Aux 1', deviceType: 'Aux 1' }, 'aux1'),
      );
    }

    if (this.platform.spa!.getIsAuxOn(2) !== undefined) {
      this.registerPart(
        parts,
        'switch-aux-2',
        new MatterSwitchAccessory(this.platform, { name: 'Spa Aux 2', deviceType: 'Aux 2' }, 'aux2'),
      );
    }
  }

  private addLockParts(parts: EndpointPart[]) {
    this.registerPart(
      parts,
      'lock-settings',
      new MatterLockAccessory(this.platform, { name: 'Spa Settings', deviceType: 'Spa Settings' }, false),
    );

    this.registerPart(
      parts,
      'lock-panel',
      new MatterLockAccessory(this.platform, { name: 'Spa Panel', deviceType: 'Spa Panel' }, true),
    );
  }

  private registerPart(parts: EndpointPart[], id: string, controller: BaseMatterSpaAccessory) {
    if (!controller.clusters) {
      throw new Error(`Composed part ${id} has no clusters defined.`);
    }

    this.routeControllerStateToPart(controller, id);
    this.partControllers.push({ id, controller });

    parts.push({
      id,
      displayName: controller.displayName,
      deviceType: controller.deviceType,
      clusters: controller.clusters,
      handlers: controller.handlers,
    });
  }

  private routeControllerStateToPart(controller: BaseMatterSpaAccessory, partId: string) {
    controller.setStateTransport(
      async (cluster: string, attributes: Record<string, unknown>) => {
        await this.matter.updateAccessoryState(this.UUID, cluster, attributes, partId);
      },
      async (cluster: string) => {
        return this.matter.getAccessoryState(this.UUID, cluster, partId);
      },
    );
  }
}
