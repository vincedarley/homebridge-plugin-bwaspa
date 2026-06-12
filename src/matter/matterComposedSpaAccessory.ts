import { MatterStatus, type MatterAccessory } from 'homebridge';
import type { EndpointType } from 'homebridge';
import { VERSION } from '../settings';
import { FLOW_FAILED, FLOW_GOOD, FLOW_LOW, SpaClient } from '../spaClient';
import type { SpaHomebridgePlatform } from '../platform';

type EndpointPart = NonNullable<MatterAccessory['parts']>[number];

type ThermostatMode = 'primary' | 'eco';
type SwitchKind = 'hold' | 'heatingReady' | 'ecoMode' | 'mister' | 'aux1' | 'aux2';

type PumpMeta = {
  kind: 'pump';
  pumpNumber: number;
  maxSpeed: number;
};

type BlowerMeta = {
  kind: 'blower';
  maxSpeed: number;
};

type LightMeta = {
  kind: 'light';
  lightNumber: number;
};

type SwitchMeta = {
  kind: 'switch';
  switchKind: SwitchKind;
};

type LockMeta = {
  kind: 'lock';
  entireSpa: boolean;
};

type ThermostatMeta = {
  kind: 'thermostat';
  mode: ThermostatMode;
};

type SensorMeta = {
  kind: 'temperature' | 'flowFailed' | 'flowLow';
};

type PartMeta = PumpMeta | BlowerMeta | LightMeta | SwitchMeta | LockMeta | ThermostatMeta | SensorMeta;

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
  private readonly partMetadata = new Map<string, PartMeta>();
  private readonly lastClusterPayload = new Map<string, string>();
  private readonly lastNonZeroByPart = new Map<string, number>();
  private readonly speedScheduleByPart = new Map<string, any>();

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
    void this.updateCharacteristics().catch((error: unknown) => {
      this.platform.log.warn('Could not set initial composed matter state for', this.displayName, 'because:', error);
    });
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }

    for (const part of this.parts) {
      const meta = this.partMetadata.get(part.id);
      if (!meta) {
        continue;
      }

      switch (meta.kind) {
        case 'pump': {
          const speed = this.platform.spa!.getPumpSpeed(meta.pumpNumber);
          const isOn = speed !== 0;
          const fanMode = this.toPumpFanModeValue(speed, meta.maxSpeed);
          const percentSetting = this.toPercentSettingValue(speed, meta.maxSpeed);

          await this.updatePartStateIfChanged(part.id, 'onOff', { onOff: isOn });
          await this.updatePartStateIfChanged(part.id, 'fanControl', {
            fanMode,
            percentSetting,
            percentCurrent: percentSetting,
          });
          if (speed > 0) {
            this.lastNonZeroByPart.set(part.id, speed);
          }
          break;
        }
        case 'blower': {
          const speed = this.platform.spa!.getBlowerSpeed();
          if (speed === undefined) {
            continue;
          }
          const isOn = speed !== 0;
          const fanMode = this.toBlowerFanModeValue(speed, meta.maxSpeed);
          const percentSetting = this.toPercentSettingValue(speed, meta.maxSpeed);

          await this.updatePartStateIfChanged(part.id, 'onOff', { onOff: isOn });
          await this.updatePartStateIfChanged(part.id, 'fanControl', {
            fanMode,
            percentSetting,
            percentCurrent: percentSetting,
          });
          if (speed > 0) {
            this.lastNonZeroByPart.set(part.id, speed);
          }
          break;
        }
        case 'light': {
          const isOn = this.platform.spa!.getIsLightOn(meta.lightNumber);
          if (isOn !== undefined) {
            await this.updatePartStateIfChanged(part.id, 'onOff', { onOff: isOn });
          }
          break;
        }
        case 'switch': {
          const isOn = this.getSwitchState(meta.switchKind);
          if (isOn !== undefined) {
            await this.updatePartStateIfChanged(part.id, 'onOff', { onOff: isOn });
          }
          break;
        }
        case 'lock': {
          const isLocked = this.platform.spa!.getIsLocked(meta.entireSpa);
          const lockState = isLocked
            ? (this.matter.types.DoorLock?.LockState?.Locked ?? 1)
            : (this.matter.types.DoorLock?.LockState?.Unlocked ?? 2);
          await this.updatePartStateIfChanged(part.id, 'doorLock', { lockState });
          break;
        }
        case 'thermostat': {
          const localTemperature = this.getLocalTemperature();
          const occupiedHeatingSetpoint = this.getOccupiedHeatingSetpoint(meta.mode);
          if (localTemperature === undefined || occupiedHeatingSetpoint === undefined) {
            continue;
          }
          const systemMode = this.getThermostatSystemMode(meta.mode);
          await this.updatePartStateIfChanged(part.id, 'thermostat', {
            localTemperature,
            occupiedHeatingSetpoint,
            controlSequenceOfOperation: this.getControlSequenceHeatingOnly(),
            systemMode,
          });
          break;
        }
        case 'temperature': {
          const current = this.platform.spa!.getCurrentTemp();
          if (current === undefined) {
            continue;
          }
          const currentC = this.platform.spa!.convertTempToC(current);
          if (currentC === undefined) {
            continue;
          }
          await this.updatePartStateIfChanged(part.id, 'temperatureMeasurement', {
            measuredValue: Math.round(currentC * 100),
          });
          break;
        }
        case 'flowFailed': {
          const flowState = this.platform.spa!.getFlowState();
          await this.updatePartStateIfChanged(part.id, 'booleanState', { stateValue: flowState === FLOW_FAILED });
          break;
        }
        case 'flowLow': {
          const flowState = this.platform.spa!.getFlowState();
          await this.updatePartStateIfChanged(part.id, 'booleanState', { stateValue: flowState === FLOW_LOW });
          break;
        }
        default:
          break;
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
      parts.push({
        id,
        displayName: `Spa Light ${lightNumber}`,
        deviceType: this.matter.deviceTypes.OnOffLight,
        clusters: { onOff: { onOff: false } },
        handlers: {
          onOff: {
            on: async (_args, context) => this.handleLightSetOn(context?.partId ?? id, true),
            off: async (_args, context) => this.handleLightSetOn(context?.partId ?? id, false),
          },
        },
      });
      this.partMetadata.set(id, { kind: 'light', lightNumber });
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
      const displayName = pumpNumber === 0 ? 'Spa Circulation Pump' : `Spa Pump ${pumpNumber}`;
      const fanModeSequence = maxSpeed <= 1
        ? (this.matter.types.FanControl?.FanModeSequence?.OffHigh ?? 2)
        : (this.matter.types.FanControl?.FanModeSequence?.OffLowHigh ?? 4);
      parts.push({
        id,
        displayName,
        deviceType: this.matter.deviceTypes.Fan,
        clusters: {
          onOff: { onOff: false },
          fanControl: {
            fanMode: (this.matter.types.FanControl?.FanMode?.Off ?? 0),
            fanModeSequence,
          },
        },
        handlers: {
          onOff: {
            on: async (_args, context) => this.handlePumpSetOn(context?.partId ?? id, true),
            off: async (_args, context) => this.handlePumpSetOn(context?.partId ?? id, false),
          },
          fanControl: {
            fanModeChange: async (request, context) => {
              await this.handlePumpFanModeChange(context?.partId ?? id, request?.fanMode);
            },
            percentSettingChange: async (request, context) => {
              await this.handlePumpPercentChange(context?.partId ?? id, request?.percentSetting);
            },
          },
        },
      });
      this.partMetadata.set(id, { kind: 'pump', pumpNumber, maxSpeed });
      this.lastNonZeroByPart.set(id, 1);
    }
  }

  private addBlowerPart(parts: EndpointPart[]) {
    const maxSpeed = this.platform.spa!.getBlowerSpeedRange();
    if (maxSpeed === 0) {
      return;
    }

    const id = 'blower';
    parts.push({
      id,
      displayName: 'Spa Blower',
      deviceType: this.matter.deviceTypes.Fan,
      clusters: {
        onOff: { onOff: false },
        fanControl: {
          fanMode: (this.matter.types.FanControl?.FanMode?.Off ?? 0),
          fanModeSequence: (this.matter.types.FanControl?.FanModeSequence?.OffLowMedHigh ?? 5),
        },
      },
      handlers: {
        onOff: {
          on: async (_args, context) => this.handleBlowerSetOn(context?.partId ?? id, true),
          off: async (_args, context) => this.handleBlowerSetOn(context?.partId ?? id, false),
        },
        fanControl: {
          fanModeChange: async (request, context) => {
            await this.handleBlowerFanModeChange(context?.partId ?? id, request?.fanMode);
          },
          percentSettingChange: async (request, context) => {
            await this.handleBlowerPercentChange(context?.partId ?? id, request?.percentSetting);
          },
        },
      },
    });
    this.partMetadata.set(id, { kind: 'blower', maxSpeed });
    this.lastNonZeroByPart.set(id, 1);
  }

  private addTemperaturePart(parts: EndpointPart[]) {
    const id = 'temperature';
    parts.push({
      id,
      displayName: 'Spa Temperature Sensor',
      deviceType: this.matter.deviceTypes.TemperatureSensor,
      clusters: {
        temperatureMeasurement: {
          measuredValue: 2000,
          minMeasuredValue: -5000,
          maxMeasuredValue: 10000,
        },
      },
    });
    this.partMetadata.set(id, { kind: 'temperature' });
  }

  private addThermostatParts(parts: EndpointPart[]) {
    const thermostatType = this.matter.deviceTypes.Thermostat;
    if (typeof thermostatType?.with !== 'function') {
      this.platform.log.warn('Matter Thermostat device type does not support .with(); skipping thermostat parts.');
      return;
    }

    const thermostatRequirement = thermostatType?.requirements?.Thermostat
      ?? thermostatType?.requirements?.ThermostatServer;
    if (typeof thermostatRequirement?.with !== 'function') {
      this.platform.log.warn('Matter Thermostat requirement does not support .with(Heating); skipping thermostat parts.');
      return;
    }

    const matterDeviceType = thermostatType.with(thermostatRequirement.with('Heating'));
    this.applyThermostatSupportedFeaturesWorkaround(matterDeviceType);

    const definitions: Array<{ id: string; displayName: string; mode: ThermostatMode; min: number; max: number; initial: number }> = [
      { id: 'thermostat-primary', displayName: 'Primary Thermostat', mode: 'primary', min: 2650, max: 4000, initial: 3850 },
      { id: 'thermostat-eco', displayName: 'Eco Thermostat', mode: 'eco', min: 1000, max: 3600, initial: 3000 },
    ];

    for (const def of definitions) {
      parts.push({
        id: def.id,
        displayName: def.displayName,
        deviceType: matterDeviceType,
        clusters: {
          thermostat: {
            localTemperature: 2000,
            occupiedHeatingSetpoint: def.initial,
            absMinHeatSetpointLimit: 700,
            absMaxHeatSetpointLimit: 4000,
            minHeatSetpointLimit: def.min,
            maxHeatSetpointLimit: def.max,
            systemMode: this.getSystemModeHeat(),
            controlSequenceOfOperation: this.getControlSequenceHeatingOnly(),
          },
        },
        handlers: {
          thermostat: {
            occupiedHeatingSetpointChange: async (request, context) => {
              await this.handleThermostatSetpointChange(context?.partId ?? def.id, request?.occupiedHeatingSetpoint);
            },
            systemModeChange: async (request, context) => {
              await this.handleThermostatSystemModeChange(context?.partId ?? def.id, request?.systemMode);
            },
          },
        },
      });
      this.partMetadata.set(def.id, { kind: 'thermostat', mode: def.mode });
    }
  }

  private addFlowParts(parts: EndpointPart[]) {
    const flowFailedId = 'flow-failed';
    parts.push({
      id: flowFailedId,
      displayName: 'Spa Flow Error',
      deviceType: this.matter.deviceTypes.LeakSensor,
      clusters: { booleanState: { stateValue: false } },
    });
    this.partMetadata.set(flowFailedId, { kind: 'flowFailed' });

    const flowLowId = 'flow-low';
    parts.push({
      id: flowLowId,
      displayName: 'Spa Flow Low',
      deviceType: this.matter.deviceTypes.ContactSensor,
      clusters: { booleanState: { stateValue: false } },
    });
    this.partMetadata.set(flowLowId, { kind: 'flowLow' });
  }

  private addSwitchParts(parts: EndpointPart[]) {
    const switchDefinitions: Array<{
      id: string;
      displayName: string;
      switchKind: SwitchKind;
      available: () => boolean;
    }> = [
      { id: 'switch-hold', displayName: 'Hold Spa', switchKind: 'hold', available: () => true },
      {
        id: 'switch-heating-ready',
        displayName: 'Spa Heat Mode Ready',
        switchKind: 'heatingReady',
        available: () => true,
      },
      {
        id: 'switch-eco-mode',
        displayName: 'Spa Eco Mode',
        switchKind: 'ecoMode',
        available: () => true,
      },
      {
        id: 'switch-mister',
        displayName: 'Spa Mister',
        switchKind: 'mister',
        available: () => this.platform.spa!.getIsMisterOn() !== undefined,
      },
      {
        id: 'switch-aux-1',
        displayName: 'Spa Aux 1',
        switchKind: 'aux1',
        available: () => this.platform.spa!.getIsAuxOn(1) !== undefined,
      },
      {
        id: 'switch-aux-2',
        displayName: 'Spa Aux 2',
        switchKind: 'aux2',
        available: () => this.platform.spa!.getIsAuxOn(2) !== undefined,
      },
    ];

    for (const def of switchDefinitions) {
      if (!def.available()) {
        continue;
      }
      parts.push({
        id: def.id,
        displayName: def.displayName,
        deviceType: this.matter.deviceTypes.OnOffSwitch,
        clusters: { onOff: { onOff: false } },
        handlers: {
          onOff: {
            on: async (_args, context) => this.handleSwitchSetOn(context?.partId ?? def.id, true),
            off: async (_args, context) => this.handleSwitchSetOn(context?.partId ?? def.id, false),
          },
        },
      });
      this.partMetadata.set(def.id, { kind: 'switch', switchKind: def.switchKind });
    }
  }

  private addLockParts(parts: EndpointPart[]) {
    const lockDefinitions = [
      { id: 'lock-settings', displayName: 'Spa Settings', entireSpa: false },
      { id: 'lock-panel', displayName: 'Spa Panel', entireSpa: true },
    ];

    for (const def of lockDefinitions) {
      parts.push({
        id: def.id,
        displayName: def.displayName,
        deviceType: this.matter.deviceTypes.DoorLock,
        clusters: {
          doorLock: {
            lockState: this.matter.types.DoorLock?.LockState?.Unlocked ?? 2,
            lockType: this.matter.types.DoorLock?.LockType?.DeadBolt ?? 0,
            operatingMode: this.matter.types.DoorLock?.OperatingMode?.Normal ?? 0,
            actuatorEnabled: true,
          },
        },
        handlers: {
          doorLock: {
            lockDoor: async (_args, context) => this.handleLockSetLocked(context?.partId ?? def.id, true),
            unlockDoor: async (_args, context) => this.handleLockSetLocked(context?.partId ?? def.id, false),
          },
        },
      });
      this.partMetadata.set(def.id, { kind: 'lock', entireSpa: def.entireSpa });
    }
  }

  private async handleLightSetOn(partId: string, value: boolean) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'light') {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }
    this.platform.spa!.setLightState(meta.lightNumber, value);
    this.platform.log.debug('Matter composed set light', meta.lightNumber, 'On ->', value);
  }

  private async handlePumpSetOn(partId: string, value: boolean) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'pump') {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    if (value) {
      this.scheduleSetPumpSpeed(partId, meta.pumpNumber, this.lastNonZeroByPart.get(partId) ?? 1, meta.maxSpeed);
    } else {
      this.scheduleSetPumpSpeed(partId, meta.pumpNumber, 0, meta.maxSpeed);
    }
  }

  private async handlePumpFanModeChange(partId: string, mode: number | undefined) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'pump' || mode === undefined) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    if (mode === this.getFanModeOff()) {
      this.scheduleSetPumpSpeed(partId, meta.pumpNumber, 0, meta.maxSpeed);
      return;
    }
    if (mode === this.getFanModeLow()) {
      this.scheduleSetPumpSpeed(partId, meta.pumpNumber, this.pumpSpeedForFanMode('low', meta.maxSpeed), meta.maxSpeed);
      return;
    }

    this.scheduleSetPumpSpeed(partId, meta.pumpNumber, this.pumpSpeedForFanMode('high', meta.maxSpeed), meta.maxSpeed);
  }

  private async handlePumpPercentChange(partId: string, percentSetting: number | null | undefined) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'pump' || percentSetting === undefined || percentSetting === null) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    const percent = Math.max(0, Math.min(100, percentSetting));
    const speed = this.pumpSpeedForPercent(percent, meta.maxSpeed);
    this.scheduleSetPumpSpeed(partId, meta.pumpNumber, speed, meta.maxSpeed);
  }

  private scheduleSetPumpSpeed(partId: string, pumpNumber: number, speed: number, maxSpeed: number) {
    this.scheduleSpeedUpdate(partId, speed, (desiredSpeed) => {
      this.platform.log.debug(
        'Matter composed set pump',
        pumpNumber,
        'speed ->',
        desiredSpeed,
        SpaClient.getSpeedAsString(maxSpeed, desiredSpeed),
        this.platform.status(),
      );
      this.platform.spa!.setPumpSpeed(pumpNumber, desiredSpeed);
    });
  }

  private async handleBlowerSetOn(partId: string, value: boolean) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'blower') {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    if (value) {
      this.scheduleSetBlowerSpeed(partId, this.lastNonZeroByPart.get(partId) ?? 1, meta.maxSpeed);
    } else {
      this.scheduleSetBlowerSpeed(partId, 0, meta.maxSpeed);
    }
  }

  private async handleBlowerFanModeChange(partId: string, mode: number | undefined) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'blower' || mode === undefined) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    if (mode === this.getFanModeOff()) {
      this.scheduleSetBlowerSpeed(partId, 0, meta.maxSpeed);
      return;
    }
    if (mode === this.getFanModeLow()) {
      this.scheduleSetBlowerSpeed(partId, this.blowerSpeedForFanMode('low', meta.maxSpeed), meta.maxSpeed);
      return;
    }
    if (mode === this.getFanModeMedium()) {
      this.scheduleSetBlowerSpeed(partId, this.blowerSpeedForFanMode('medium', meta.maxSpeed), meta.maxSpeed);
      return;
    }

    this.scheduleSetBlowerSpeed(partId, this.blowerSpeedForFanMode('high', meta.maxSpeed), meta.maxSpeed);
  }

  private async handleBlowerPercentChange(partId: string, percentSetting: number | null | undefined) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'blower' || percentSetting === undefined || percentSetting === null) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    const percent = Math.max(0, Math.min(100, percentSetting));
    const speed = Math.max(0, Math.min(meta.maxSpeed, Math.round((percent * meta.maxSpeed) / 100.0)));
    this.scheduleSetBlowerSpeed(partId, speed, meta.maxSpeed);
  }

  private scheduleSetBlowerSpeed(partId: string, speed: number, maxSpeed: number) {
    this.scheduleSpeedUpdate(partId, speed, (desiredSpeed) => {
      this.platform.log.debug(
        'Matter composed set blower speed ->',
        desiredSpeed,
        SpaClient.getSpeedAsString(maxSpeed, desiredSpeed),
        this.platform.status(),
      );
      this.platform.spa!.setBlowerSpeed(desiredSpeed);
    });
  }

  private scheduleSpeedUpdate(partId: string, speed: number, setter: (speed: number) => void) {
    const existing = this.speedScheduleByPart.get(partId);
    if (existing) {
      clearTimeout(existing);
      this.speedScheduleByPart.delete(partId);
    }

    const timeout = setTimeout(() => {
      setter(speed);
      if (speed > 0) {
        this.lastNonZeroByPart.set(partId, speed);
      }
      this.speedScheduleByPart.delete(partId);
    }, 10);

    this.speedScheduleByPart.set(partId, timeout);
  }

  private async handleSwitchSetOn(partId: string, value: boolean) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'switch') {
      return;
    }

    if (!this.platform.isCurrentlyConnected()) {
      if (meta.switchKind === 'hold' || meta.switchKind === 'heatingReady' || meta.switchKind === 'ecoMode') {
        this.platform.recordAction(this.handleSwitchSetOn.bind(this, partId, value));
      }
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    switch (meta.switchKind) {
      case 'hold':
        this.platform.spa!.setIsHold(value);
        this.platform.log.debug('Matter composed set Hold On ->', value);
        break;
      case 'heatingReady':
        this.platform.spa!.setHeatingModeAlwaysReady(value);
        this.platform.log.debug('Matter composed set Heating Always Ready On ->', value);
        break;
      case 'ecoMode':
        this.platform.spa!.setTempRangeIsHigh(!value);
        this.platform.log.debug('Matter composed set Eco Mode On ->', value);
        break;
      case 'mister':
        this.platform.spa!.setMisterState(value);
        this.platform.log.debug('Matter composed set Mister On ->', value);
        break;
      case 'aux1':
        this.platform.spa!.setAuxState(1, value);
        this.platform.log.debug('Matter composed set Aux 1 On ->', value);
        break;
      case 'aux2':
        this.platform.spa!.setAuxState(2, value);
        this.platform.log.debug('Matter composed set Aux 2 On ->', value);
        break;
      default:
        break;
    }
  }

  private async handleLockSetLocked(partId: string, value: boolean) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'lock') {
      return;
    }

    if (!this.platform.isCurrentlyConnected()) {
      this.platform.recordAction(this.handleLockSetLocked.bind(this, partId, value));
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    this.platform.spa!.setIsLocked(meta.entireSpa, value);
    this.platform.log.debug('Matter composed set lock', meta.entireSpa ? 'panel' : 'settings', '->', value);
  }

  private async handleThermostatSetpointChange(partId: string, setpoint: number | undefined) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'thermostat' || setpoint === undefined) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    let tempC = setpoint / 100.0;
    if (meta.mode === 'primary') {
      tempC = Math.max(26.5, Math.min(40.0, tempC));
    } else {
      tempC = Math.max(10.0, Math.min(36.0, tempC));
    }

    const converted = this.platform.spa!.convertTempFromC(tempC);
    if (converted === undefined) {
      return;
    }

    this.platform.spa!.setTargetTemperature(converted);
    this.platform.log.debug('Matter composed set', meta.mode, 'thermostat target ->', tempC, 'C');
  }

  private async handleThermostatSystemModeChange(partId: string, mode: number | undefined) {
    const meta = this.partMetadata.get(partId);
    if (!meta || meta.kind !== 'thermostat' || mode === undefined) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    const flowState = this.platform.spa!.getFlowState();
    if (mode === this.getSystemModeOff()) {
      const isSpaInHighRange = this.platform.spa!.getTempRangeIsHigh();
      const isThisThermostatActive = meta.mode === 'primary' ? isSpaInHighRange : !isSpaInHighRange;
      if (flowState === FLOW_GOOD && isThisThermostatActive) {
        const shouldBeHighRange = meta.mode === 'eco';
        this.platform.spa!.setTempRangeIsHigh(shouldBeHighRange);
      }
      return;
    }

    if (mode !== this.getSystemModeHeat()) {
      throw new Error('Spa thermostat supports Heat and Off modes only.');
    }

    if (flowState !== FLOW_GOOD) {
      throw new Error('Water flow is low or has failed. Heating off');
    }

    const shouldBeHighRange = meta.mode === 'primary';
    this.platform.spa!.setTempRangeIsHigh(shouldBeHighRange);
    this.platform.log.debug('Matter composed set thermostat mode', meta.mode, '-> Heat');
  }

  private getLocalTemperature() {
    const current = this.platform.spa!.getCurrentTemp();
    if (current === undefined) {
      return undefined;
    }
    const currentC = this.platform.spa!.convertTempToC(current);
    if (currentC === undefined) {
      return undefined;
    }
    return Math.round(currentC * 100);
  }

  private getOccupiedHeatingSetpoint(mode: ThermostatMode) {
    const target = mode === 'primary'
      ? this.platform.spa!.getTargetTempHigh()
      : this.platform.spa!.getTargetTempLow();

    if (target === undefined) {
      return undefined;
    }

    const targetC = this.platform.spa!.convertTempToC(target);
    if (targetC === undefined) {
      return undefined;
    }

    const targetCenti = Math.round(targetC * 100);
    if (mode === 'primary') {
      return Math.max(2650, Math.min(4000, targetCenti));
    }

    return Math.max(1000, Math.min(3600, targetCenti));
  }

  private getThermostatSystemMode(mode: ThermostatMode) {
    const flowState = this.platform.spa!.getFlowState();
    if (flowState === FLOW_FAILED) {
      return this.getSystemModeOff();
    }

    const isSpaInHighRange = this.platform.spa!.getTempRangeIsHigh();
    const isActive = mode === 'primary' ? isSpaInHighRange : !isSpaInHighRange;
    return isActive ? this.getSystemModeHeat() : this.getSystemModeOff();
  }

  private getSwitchState(switchKind: SwitchKind) {
    switch (switchKind) {
      case 'hold':
        return this.platform.spa!.getIsHold();
      case 'heatingReady':
        return this.platform.spa!.isHeatingModeAlwaysReady();
      case 'ecoMode':
        return !this.platform.spa!.getTempRangeIsHigh();
      case 'mister':
        return this.platform.spa!.getIsMisterOn();
      case 'aux1':
        return this.platform.spa!.getIsAuxOn(1);
      case 'aux2':
        return this.platform.spa!.getIsAuxOn(2);
      default:
        return undefined;
    }
  }

  private toPumpFanModeValue(speed: number, maxSpeed: number) {
    if (speed <= 0) {
      return this.getFanModeOff();
    }
    if (maxSpeed <= 1) {
      return this.getFanModeHigh();
    }
    return speed >= 2 ? this.getFanModeHigh() : this.getFanModeLow();
  }

  private toBlowerFanModeValue(speed: number, maxSpeed: number) {
    if (speed <= 0) {
      return this.getFanModeOff();
    }
    if (maxSpeed <= 1) {
      return this.getFanModeHigh();
    }
    if (maxSpeed === 2) {
      return speed >= 2 ? this.getFanModeHigh() : this.getFanModeLow();
    }
    if (speed >= maxSpeed) {
      return this.getFanModeHigh();
    }
    if (speed >= 2) {
      return this.getFanModeMedium();
    }
    return this.getFanModeLow();
  }

  private toPercentSettingValue(speed: number, maxSpeed: number) {
    if (speed <= 0 || maxSpeed <= 0) {
      return 0;
    }
    return Math.max(1, Math.min(100, Math.round((100.0 * speed) / maxSpeed)));
  }

  private pumpSpeedForFanMode(mode: 'low' | 'high', maxSpeed: number) {
    if (maxSpeed <= 1) {
      return mode === 'high' ? 1 : 0;
    }
    return mode === 'high' ? maxSpeed : 1;
  }

  private pumpSpeedForPercent(percent: number, maxSpeed: number) {
    if (maxSpeed <= 1) {
      return percent >= 50 ? 1 : 0;
    }
    if (percent < 25) {
      return 0;
    }
    if (percent < 75) {
      return 1;
    }
    return Math.min(maxSpeed, 2);
  }

  private blowerSpeedForFanMode(mode: 'low' | 'medium' | 'high', maxSpeed: number) {
    if (maxSpeed <= 1) {
      return mode === 'high' ? 1 : 0;
    }
    if (mode === 'high') {
      return maxSpeed;
    }
    if (mode === 'medium') {
      return Math.max(1, Math.min(maxSpeed, Math.round((maxSpeed + 1) / 2)));
    }
    return 1;
  }

  private getFanModeOff() {
    return this.matter.types.FanControl?.FanMode?.Off ?? 0;
  }

  private getFanModeLow() {
    return this.matter.types.FanControl?.FanMode?.Low ?? 1;
  }

  private getFanModeMedium() {
    return this.matter.types.FanControl?.FanMode?.Medium ?? 2;
  }

  private getFanModeHigh() {
    return this.matter.types.FanControl?.FanMode?.High ?? 3;
  }

  private getSystemModeOff() {
    return this.matter.types.Thermostat?.SystemMode?.Off ?? 0;
  }

  private getSystemModeHeat() {
    return this.matter.types.Thermostat?.SystemMode?.Heat ?? 4;
  }

  private getControlSequenceHeatingOnly() {
    return this.matter.types.Thermostat?.ControlSequenceOfOperation?.HeatingOnly ?? 4;
  }

  private applyThermostatSupportedFeaturesWorkaround(matterDeviceType: any) {
    const behaviorsStructure = matterDeviceType?.behaviors;
    if (!behaviorsStructure) {
      return;
    }

    const behaviorsArray = Array.isArray(behaviorsStructure)
      ? behaviorsStructure
      : Object.values(behaviorsStructure);
    const thermostatBehavior = behaviorsArray.find((b: any) => b?.cluster?.id === 0x201 || b?.id === 'thermostat');
    if (thermostatBehavior && thermostatBehavior.cluster && thermostatBehavior.features) {
      thermostatBehavior.cluster.supportedFeatures = thermostatBehavior.features;
    }
  }

  private async updatePartStateIfChanged(partId: string, cluster: string, attributes: Record<string, unknown>) {
    const key = `${partId}:${cluster}`;
    const serialized = JSON.stringify(attributes);
    if (this.lastClusterPayload.get(key) === serialized) {
      return;
    }

    await this.matter.updateAccessoryState(this.UUID, cluster, attributes, partId);
    this.lastClusterPayload.set(key, serialized);
  }
}
