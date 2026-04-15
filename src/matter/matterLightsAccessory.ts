import { SpaHomebridgePlatform } from '../platform';

export class MatterLightsAccessory {
  private readonly matter: any;
  private lastOn: boolean | undefined = undefined;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
    private readonly lightNumber: number,
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
    if (this.platform.spa!.getIsLightOn(this.lightNumber) === undefined) {
      this.platform.log.warn('Nonexistent matter light', this.lightNumber, 'accessory declared.');
    }
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }
    const isOn = this.platform.spa!.getIsLightOn(this.lightNumber);
    if (isOn === undefined) {
      return;
    }

    if (this.lastOn !== isOn) {
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.OnOff, { onOff: isOn });
      this.lastOn = isOn;
    }
  }

  private async setOn(value: boolean) {
    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }
    this.platform.spa!.setLightState(this.lightNumber, value);
    this.platform.log.debug('Matter set Lights', this.lightNumber, 'On ->', value);
  }
}