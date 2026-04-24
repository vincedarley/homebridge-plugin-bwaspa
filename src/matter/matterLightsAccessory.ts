import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';
import type { SpaHomebridgePlatform } from '../platform';

export class MatterLightsAccessory extends BaseMatterSpaAccessory {
  private readonly lightNumber: number;
  private lastOn: boolean | undefined = undefined;

  constructor(
    platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
    lightNumber: number,
  ) {
    const matter = (platform.api as any).matter;
    super(
      platform,
      device,
      matter.deviceTypes.OnOffLight,
      { onOff: { onOff: false } },
      {
        onOff: {
          on: async () => this.setOn(true),
          off: async () => this.setOn(false),
        },
      },
    );
    this.lightNumber = lightNumber;
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
      await this.updateState('onOff', { onOff: isOn });
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