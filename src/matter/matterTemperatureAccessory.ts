import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';
import type { SpaHomebridgePlatform } from '../platform';

export class MatterTemperatureAccessory extends BaseMatterSpaAccessory {
  private lastMeasuredValue: number | null = null;

  constructor(
    platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
  ) {
    const matter = (platform.api as any).matter;
    super(
      platform,
      device,
      matter.deviceTypes.TemperatureSensor,
      {
        temperatureMeasurement: {
          measuredValue: 2000,
          minMeasuredValue: -5000,
          maxMeasuredValue: 10000,
        },
      },
    );
  }

  spaConfigurationKnown() {
    // Set initial temperature reading
    void this.updateCharacteristics().catch((error: unknown) => {
      this.platform.log.warn('Could not set initial temperature for', this.displayName, 'because:', error);
    });
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }

    const temp = this.platform.spa!.getCurrentTemp();
    if (temp === undefined) {
      return;
    }
    const valC = this.platform.spa!.convertTempToC(temp);
    if (valC === undefined) {
      return;
    }
    const measuredValue = Math.round(valC * 100);

    if (this.lastMeasuredValue !== measuredValue) {
      await this.updateState('temperatureMeasurement', { measuredValue });
      this.lastMeasuredValue = measuredValue;
    }
  }
}