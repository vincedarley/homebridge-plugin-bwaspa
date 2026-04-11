import { FLOW_FAILED } from './spaClient';
import { SpaHomebridgePlatform } from './platform';

export class MatterFlowAccessory {
  private readonly matter: any;
  private lastLeakDetected: boolean | undefined = undefined;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
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
    const leakDetected = flowState === FLOW_FAILED;

    if (this.lastLeakDetected !== leakDetected) {
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.BooleanState, {
        stateValue: leakDetected,
      });
      this.lastLeakDetected = leakDetected;
    }
  }
}