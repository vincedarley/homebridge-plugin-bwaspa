import { SpaHomebridgePlatform } from '../platform';

export class MatterLockAccessory {
  private readonly matter: any;
  private lastLocked: boolean | undefined = undefined;
  private readonly lockStateUnlocked: number;
  private readonly lockStateLocked: number;
  private readonly lockTypeOther: number;
  private readonly operatingModeNormal: number;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
    private readonly entireSpa: boolean,
  ) {
    this.matter = (this.platform.api as any).matter;
    this.lockStateUnlocked = this.matter.types.DoorLock?.LockState?.Unlocked ?? 2;
    this.lockStateLocked = this.matter.types.DoorLock?.LockState?.Locked ?? 1;
    this.lockTypeOther = this.matter.types.DoorLock?.LockType?.Other ?? 0;
    this.operatingModeNormal = this.matter.types.DoorLock?.OperatingMode?.Normal ?? 0;

    if (!this.accessory.clusters) {
      this.accessory.clusters = {};
    }
    if (!this.accessory.clusters.doorLock) {
      this.accessory.clusters.doorLock = {
        lockState: this.lockStateUnlocked,
        lockType: this.lockTypeOther,
        operatingMode: this.operatingModeNormal,
        actuatorEnabled: true,
      };
    }

    this.accessory.handlers = {
      doorLock: {
        lockDoor: async () => this.setLocked(true),
        unlockDoor: async () => this.setLocked(false),
      },
    };
  }

  spaConfigurationKnown() {
    // nothing to do
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }

    const isLocked = this.platform.spa!.getIsLocked(this.entireSpa);
    if (this.lastLocked !== isLocked) {
      const lockState = isLocked
        ? this.lockStateLocked
        : this.lockStateUnlocked;
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.DoorLock, {
        lockState,
      });
      this.lastLocked = isLocked;
    }
  }

  private async setLocked(value: boolean) {
    if (!this.platform.isCurrentlyConnected()) {
      this.platform.recordAction(this.setLocked.bind(this, value));
      throw this.platform.connectionProblem;
    }
    this.platform.spa!.setIsLocked(this.entireSpa, value);
    this.platform.log.debug('Matter set Locked Spa', this.entireSpa ? 'Panel' : 'Settings', '->', value);
  }
}