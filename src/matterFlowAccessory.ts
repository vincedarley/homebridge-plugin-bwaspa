import { FLOW_FAILED, FLOW_LOW } from './spaClient';
import { SpaHomebridgePlatform } from './platform';

type FlowSensorMode = 'failed' | 'low';

export class MatterFlowAccessory {
  private readonly matter: any;
  private lastState: boolean | undefined = undefined;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
    private readonly mode: FlowSensorMode,
  ) {
    this.matter = (this.platform.api as any).matter;

    if (!this.accessory.clusters) {
      this.accessory.clusters = {};
    }
    if (!this.accessory.clusters.booleanState) {
      this.accessory.clusters.booleanState = {
        stateValue: false,
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
    const flowState = this.platform.spa!.getFlowState();
    const stateValue = this.mode === 'failed'
      ? flowState === FLOW_FAILED
      : flowState === FLOW_LOW;

    if (this.lastState !== stateValue) {
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.BooleanState, {
        stateValue,
      });
      this.lastState = stateValue;
    }
  }
}