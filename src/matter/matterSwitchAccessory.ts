import { SpaHomebridgePlatform } from '../platform';

type SwitchKind = 'hold' | 'heatingReady' | 'mister' | 'aux1' | 'aux2';

export class MatterSwitchAccessory {
  private readonly matter: any;
  private lastOn: boolean | undefined = undefined;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
    private readonly kind: SwitchKind,
  ) {
    this.matter = (this.platform.api as any).matter;

    if (!this.accessory.clusters) {
      this.accessory.clusters = {};
    }
    if (!this.accessory.clusters.onOff) {
      this.accessory.clusters.onOff = { onOff: false };
    }

    this.accessory.handlers = {
      onOff: {
        on: async () => this.setOn(true),
        off: async () => this.setOn(false),
      },
    };
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
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.OnOff, { onOff: isOn });
      this.lastOn = isOn;
    }
  }

  private getCurrentState() {
    switch (this.kind) {
      case 'hold':
        return this.platform.spa!.getIsHold();
      case 'heatingReady':
        return this.platform.spa!.isHeatingModeAlwaysReady();
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
      if (this.kind === 'hold' || this.kind === 'heatingReady') {
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