import { SpaHomebridgePlatform } from './platform';

export class MatterTemperatureAccessory {
  private readonly matter: any;
  private lastMeasuredValue: number | null = null;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
  ) {
    this.matter = (this.platform.api as any).matter;

    if (!this.accessory.clusters) {
      this.accessory.clusters = {};
    }
    if (!this.accessory.clusters.temperatureMeasurement) {
      this.accessory.clusters.temperatureMeasurement = {
        measuredValue: 2000,
        minMeasuredValue: -5000,
        maxMeasuredValue: 10000,
      };
    }
  }

  spaConfigurationKnown() {
    // nothing to do
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
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.TemperatureMeasurement, {
        measuredValue,
      });
      this.lastMeasuredValue = measuredValue;
    }
  }
}