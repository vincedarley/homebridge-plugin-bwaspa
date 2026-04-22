import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';
import type { SpaHomebridgePlatform } from '../platform';

type SwitchKind = 'hold' | 'heatingReady' | 'vacationMode' | 'mister' | 'aux1' | 'aux2';

function kindForDeviceType(deviceType: string): SwitchKind | undefined {
  switch (deviceType) {
    case 'Hold Switch': return 'hold';
    case 'Spa Heat Mode Ready': return 'heatingReady';
    case 'Vacation Mode': return 'vacationMode';
    case 'Mister': return 'mister';
    case 'Aux 1': return 'aux1';
    case 'Aux 2': return 'aux2';
    default: return undefined;
  }
}

export class MatterSwitchAccessory extends BaseMatterSpaAccessory {
  private readonly kind: SwitchKind;
  private lastOn: boolean | undefined = undefined;

  constructor(
    platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
  ) {
    const matter = (platform.api as any).matter;
    super(
      platform,
      device,
      matter.deviceTypes.OnOffSwitch,
      { onOff: { onOff: false } },
      {
        onOff: {
          on: async () => this.setOn(true),
          off: async () => this.setOn(false),
        },
      },
    );
    this.kind = kindForDeviceType(device.deviceType)!;
  }

  spaConfigurationKnown() {
    switch (this.kind) {
      case 'mister':
        if (this.platform.spa!.getIsMisterOn() === undefined) {
          this.platform.log.warn('Nonexistent matter mister accessory declared.');
        }
        break;
      case 'aux1':
        if (this.platform.spa!.getIsAuxOn(1) === undefined) {
          this.platform.log.warn('Nonexistent matter aux 1 accessory declared.');
        }
        break;
      case 'aux2':
        if (this.platform.spa!.getIsAuxOn(2) === undefined) {
          this.platform.log.warn('Nonexistent matter aux 2 accessory declared.');
        }
        break;
      default:
        break;
    }
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }

    const isOn = this.getCurrentState();
    if (isOn === undefined) {
      return;
    }

    if (this.lastOn !== isOn) {
      await this.updateState('onOff', { onOff: isOn });
      this.lastOn = isOn;
    }
  }

  private getCurrentState() {
    switch (this.kind) {
      case 'hold':
        return this.platform.spa!.getIsHold();
      case 'heatingReady':
        return this.platform.spa!.isHeatingModeAlwaysReady();
      case 'vacationMode':
        // User-facing semantics requested: On => Unoccupied/low temp range.
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

  private async setOn(value: boolean) {
    if (!this.platform.isCurrentlyConnected()) {
      if (this.kind === 'hold' || this.kind === 'heatingReady' || this.kind === 'vacationMode') {
        this.platform.recordAction(this.setOn.bind(this, value));
      }
      throw this.platform.connectionProblem;
    }

    switch (this.kind) {
      case 'hold':
        this.platform.spa!.setIsHold(value);
        this.platform.log.debug('Matter set Hold On ->', value);
        break;
      case 'heatingReady':
        this.platform.spa!.setHeatingModeAlwaysReady(value);
        this.platform.log.debug('Matter set Heating Always Ready On ->', value);
        break;
      case 'vacationMode':
        this.platform.spa!.setTempRangeIsHigh(!value);
        this.platform.log.debug('Matter set Vacation Mode On (unoccupied/low range) ->', value);
        break;
      case 'mister':
        this.platform.spa!.setMisterState(value);
        this.platform.log.debug('Matter set Mister On ->', value);
        break;
      case 'aux1':
        this.platform.spa!.setAuxState(1, value);
        this.platform.log.debug('Matter set Aux 1 On ->', value);
        break;
      case 'aux2':
        this.platform.spa!.setAuxState(2, value);
        this.platform.log.debug('Matter set Aux 2 On ->', value);
        break;
      default:
        break;
    }
  }
}