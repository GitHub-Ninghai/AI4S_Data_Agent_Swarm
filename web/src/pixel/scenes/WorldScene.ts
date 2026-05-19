import Phaser from "phaser";
import type { WorldConfig, AgentWorldData } from "../types";
import { MapManager } from "../systems/MapManager";
import { CameraController } from "../systems/CameraController";
import { worldEventBus } from "../systems/WorldEventBus";
import { AgentSprite } from "../objects/AgentSprite";

/**
 * All sprite sheet keys that need animations registered.
 * Each key maps to a loaded spritesheet in BootScene.
 */
const SPRITE_KEYS = [
  "character-default",
  "character-001",
  "character-002",
  "character-003",
  "character-004",
] as const;

export class WorldScene extends Phaser.Scene {
  private cameraController!: CameraController;
  private worldConfig!: WorldConfig;
  private mapManager!: MapManager;

  /** Agent sprites indexed by agentId */
  private agents: Map<string, AgentSprite> = new Map();

  /** Unsubscribe functions for event bus */
  private cleanups: Array<() => void> = [];

  /** Demo wandering timers keyed by agentId */
  private wanderTimers: Map<string, Phaser.Time.TimerEvent> = new Map();

  constructor() {
    super({ key: "WorldScene" });
  }

  create(): void {
    this.worldConfig = this.cache.json.get("world-config") as WorldConfig;

    // --- Background ---
    this.add.image(0, 0, "world-bg").setOrigin(0, 0);

    // --- Systems ---
    // MapManager parses collision grid from collision.png texture.
    // Stored in scene data for access by agents during movement / pathfinding.
    const mapManager = new MapManager(this, this.worldConfig);
    this.mapManager = mapManager;
    this.data.set("mapManager", mapManager);
    this.cameraController = new CameraController(this);

    // --- Camera: fit entire map into viewport ---
    this.cameraController.fitMapToViewport(
      this.worldConfig.backgroundWidth,
      this.worldConfig.backgroundHeight
    );

    // --- Register sprite animations for all character sheets ---
    this.registerAnimations();

    // --- Set camera world bounds ---
    this.cameras.main.setBounds(
      0,
      0,
      this.worldConfig.backgroundWidth,
      this.worldConfig.backgroundHeight
    );

    // --- Listen to React events ---
    this.setupEventListeners();

    // --- Draw area labels ---
    this.drawAreaLabels();

    // --- Notify React that the scene is ready ---
    worldEventBus.emit("scene:ready", undefined);

    // --- Spawn demo bees that wander around ---
    this.spawnDemoBees();
  }

  // ---------------------------------------------------------------------------
  // Animation registration
  // ---------------------------------------------------------------------------

  /**
   * Register animations for every loaded spritesheet.
   * Keys follow the pattern: `{spriteKey}-{animName}` so that
   * AgentSprite.playAnimation() can find them.
   *
   * Frame layout (6 cols x 5 rows, 170x204 per frame):
   *   Row 0: Walk-L   (frames 0-5)
   *   Row 1: Walk-D   (frames 6-11)
   *   Row 2: Walk-U   (frames 12-17)
   *   Row 3: Idle     (frames 18-21: down, up, left, right)
   *   Row 4: Work-D   (frames 24-29)
   */
  private registerAnimations(): void {
    for (const spriteKey of SPRITE_KEYS) {
      const prefix = spriteKey;
      const texture = this.textures.get(spriteKey as string);

      // Helper: register animation only if all referenced frames exist in texture.
      // frameTotal includes __BASE, so the last valid frame index is frameTotal - 2.
      const lastFrame = texture.frameTotal - 2;

      const safeCreate = (
        key: string,
        frames: Phaser.Types.Animations.AnimationFrameConfig[],
        frameRate: number,
        repeat = -1
      ) => {
        const allValid = frames.every(f => (f.frame ?? 0) <= lastFrame);
        if (!allValid) return;
        this.anims.create({ key, frames, frameRate, repeat });
      };

      // Actual max animation frame index (excluding __BASE)
      const maxFrame = Math.max(0, lastFrame);

      // Walk Left — Row 0 (frames 0-5)
      safeCreate(
        `${prefix}-walk-left`,
        this.anims.generateFrameNumbers(spriteKey as string, {
          start: 0,
          end: 5,
        }),
        8
      );

      // Walk Down — Row 1 (frames 6-11)
      safeCreate(
        `${prefix}-walk-down`,
        this.anims.generateFrameNumbers(spriteKey as string, {
          start: 6,
          end: 11,
        }),
        8
      );

      // Walk Up — Row 2 (frames 12-17)
      safeCreate(
        `${prefix}-walk-up`,
        this.anims.generateFrameNumbers(spriteKey as string, {
          start: 12,
          end: 17,
        }),
        8
      );

      // Idle — Row 3 (frames 18-21)
      safeCreate(
        `${prefix}-idle-down`,
        [{ key: spriteKey as string, frame: 18 }],
        1
      );
      safeCreate(
        `${prefix}-idle-up`,
        [{ key: spriteKey as string, frame: 19 }],
        1
      );
      safeCreate(
        `${prefix}-idle-left`,
        [{ key: spriteKey as string, frame: 20 }],
        1
      );
      safeCreate(
        `${prefix}-idle-right`,
        [{ key: spriteKey as string, frame: 21 }],
        1
      );

      // Work Down — Row 4 (frames 24-29)
      safeCreate(
        `${prefix}-work-down`,
        this.anims.generateFrameNumbers(spriteKey as string, {
          start: 24,
          end: 29,
        }),
        6
      );

      // Fallback: if NO idle animation registered, create idle-down from frame 0
      if (!this.anims.get(`${prefix}-idle-down`)) {
        this.anims.create({
          key: `${prefix}-idle-down`,
          frames: [{ key: spriteKey as string, frame: 0 }],
          frameRate: 1,
        });
      }

      // Fallback: if NO walk animation registered, create walk-down from available frames
      if (!this.anims.get(`${prefix}-walk-down`) && maxFrame > 0) {
        this.anims.create({
          key: `${prefix}-walk-down`,
          frames: this.anims.generateFrameNumbers(spriteKey as string, {
            start: 0,
            end: maxFrame,
          }),
          frameRate: 8,
          repeat: -1,
        });
      }

      // Fallback: if NO work animation registered, reuse walk-down or idle
      if (!this.anims.get(`${prefix}-work-down`)) {
        const walkAnim = this.anims.get(`${prefix}-walk-down`);
        if (walkAnim) {
          this.anims.create({
            key: `${prefix}-work-down`,
            frames: walkAnim.frames,
            frameRate: 6,
            repeat: -1,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Demo bees — random wandering for default scene
  // ---------------------------------------------------------------------------

  private readonly DEMO_BEES = [
    {
      id: "demo-1",
      name: "论文爬取蜂",
      sprite: "character-002",
      tint: 0xffffff,
    },
    {
      id: "demo-2",
      name: "PDF 解析蜂",
      sprite: "character-002",
      tint: 0x99ccff,
    },
    {
      id: "demo-3",
      name: "数据合成蜂",
      sprite: "character-002",
      tint: 0xffcc99,
    },
  ];

  /** All walkable area bounding boxes for random target picking */
  private getWalkableAreas(): { x: number; y: number; w: number; h: number }[] {
    return this.worldConfig.areas.map(a => ({
      x: a.x + 32,
      y: a.y + 48,
      w: a.width - 64,
      h: a.height - 80,
    }));
  }

  /** Pick a random walkable position inside one of the areas */
  private randomWalkablePosition(): { x: number; y: number } {
    const areas = this.getWalkableAreas();
    // Pick a random area
    const area = areas[Math.floor(Math.random() * areas.length)];
    return {
      x: area.x + Math.random() * area.w,
      y: area.y + Math.random() * area.h,
    };
  }

  private spawnDemoBees(): void {
    for (const bee of this.DEMO_BEES) {
      const pos = this.randomWalkablePosition();
      const sprite = new AgentSprite(
        this,
        bee.id,
        bee.name,
        pos.x,
        pos.y,
        bee.sprite
      );
      sprite.setDepth(10);
      if (bee.tint !== 0xffffff) {
        sprite.setTint(bee.tint);
      }
      sprite.setVisualState("idle");
      this.agents.set(bee.id, sprite);

      // Start wandering after a short random delay
      const initialDelay = 500 + Math.random() * 3000;
      this.time.delayedCall(initialDelay, () => this.wanderTo(bee.id));
    }
  }

  /** Send a demo bee to a random position; on arrival, wait then wander again */
  private wanderTo(agentId: string): void {
    const sprite = this.agents.get(agentId);
    if (!sprite) return;

    const target = this.randomWalkablePosition();
    sprite.navigateTo(target.x, target.y);

    // Set a timer to check arrival and trigger next wander
    // We poll because we don't have an "arrived" callback
    const checkArrival = () => {
      const s = this.agents.get(agentId);
      if (!s) return;
      if (!s.isMoving) {
        // Arrived — wait 1-4 seconds then wander again
        const wait = 1000 + Math.random() * 3000;
        const timer = this.time.delayedCall(wait, () => this.wanderTo(agentId));
        this.wanderTimers.set(agentId, timer);
      } else {
        // Still moving, check again in 200ms
        const timer = this.time.delayedCall(200, checkArrival);
        this.wanderTimers.set(agentId, timer);
      }
    };

    const timer = this.time.delayedCall(300, checkArrival);
    this.wanderTimers.set(agentId, timer);
  }

  // ---------------------------------------------------------------------------
  // Area labels
  // ---------------------------------------------------------------------------

  private drawAreaLabels(): void {
    for (const area of this.worldConfig.areas) {
      const centerX = area.x + area.width / 2;
      const centerY = area.y + 16;

      this.add
        .text(centerX, centerY, area.name, {
          fontSize: "14px",
          color: "#ffffff",
          backgroundColor: "#00000066",
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 0)
        .setDepth(1);
    }
  }

  // ---------------------------------------------------------------------------
  // Event bus listeners
  // ---------------------------------------------------------------------------

  private setupEventListeners(): void {
    const onAgentAdded = (data: AgentWorldData) => this.addAgent(data);
    const onAgentUpdated = (data: AgentWorldData) => this.updateAgent(data);
    const onAgentRemoved = (agentId: string) => this.removeAgent(agentId);
    const onSelectAgent = (agentId: string) => this.focusOnAgent(agentId);
    const onCameraFocus = (pos: { x: number; y: number }) => {
      this.cameraController.focusAgent(pos.x, pos.y);
    };

    const unsub1 = worldEventBus.on("agent:added", onAgentAdded);
    const unsub2 = worldEventBus.on("agent:updated", onAgentUpdated);
    const unsub3 = worldEventBus.on("agent:removed", onAgentRemoved);
    const unsub4 = worldEventBus.on("select:agent", onSelectAgent);
    const unsub5 = worldEventBus.on("camera:focus", onCameraFocus);

    this.cleanups.push(unsub1, unsub2, unsub3, unsub4, unsub5);
  }

  // ---------------------------------------------------------------------------
  // Agent lifecycle
  // ---------------------------------------------------------------------------

  private addAgent(data: AgentWorldData): void {
    if (this.agents.has(data.agentId)) {
      this.updateAgent(data);
      return;
    }

    const spriteKey = data.spriteKey || "character-default";

    const agentSprite = new AgentSprite(
      this,
      data.agentId,
      data.agentName,
      data.x,
      data.y,
      spriteKey
    );

    agentSprite.setDepth(10);

    // Click detection on the container
    agentSprite.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, 60, 70),
      Phaser.Geom.Rectangle.Contains
    );
    agentSprite.on("pointerdown", () => {
      worldEventBus.emit("agent:clicked", data.agentId);
    });

    // Set initial visual state (map from our state names to AgentSprite's state names)
    agentSprite.setVisualState(this.mapVisualState(data.visualState));

    // If the agent needs to move to a target position, start movement
    if (data.targetX !== data.x || data.targetY !== data.y) {
      agentSprite.navigateTo(data.targetX, data.targetY);
    }

    this.agents.set(data.agentId, agentSprite);
  }

  private updateAgent(data: AgentWorldData): void {
    const existing = this.agents.get(data.agentId);
    if (!existing) {
      this.addAgent(data);
      return;
    }

    // Update name if changed
    if (existing.agentName !== data.agentName) {
      existing.setName(data.agentName);
    }

    // Update sprite key if changed
    if (data.spriteKey && existing.spriteKey !== data.spriteKey) {
      existing.setSpriteKey(data.spriteKey);
    }

    // Map AgentWorldData visual state to AgentSprite visual state
    const visualState = this.mapVisualState(data.visualState);
    existing.setVisualState(visualState);

    // Move to target if position changed
    if (data.targetX !== existing.x || data.targetY !== existing.y) {
      existing.navigateTo(data.targetX, data.targetY);
    }
  }

  /** Map our AgentVisualState to the AgentSprite's visual state enum. */
  private mapVisualState(
    state: AgentWorldData["visualState"]
  ): "idle" | "working" | "stuck" | "offline" | "celebrate" | "moving" {
    switch (state) {
      case "idle":
        return "idle";
      case "working":
        return "working";
      case "stuck":
        return "stuck";
      case "offline":
        return "offline";
      case "celebrating":
        return "celebrate";
      case "walking":
        return "moving";
      default:
        return "idle";
    }
  }

  private removeAgent(agentId: string): void {
    const existing = this.agents.get(agentId);
    if (!existing) return;

    existing.destroy(true);
    this.agents.delete(agentId);
  }

  private focusOnAgent(agentId: string): void {
    const existing = this.agents.get(agentId);
    if (!existing) return;
    this.cameraController.focusAgent(existing.x, existing.y);
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  update(time: number, delta: number): void {
    // Drive each AgentSprite's per-frame update (movement, etc.)
    for (const agent of this.agents.values()) {
      agent.update(time, delta);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  shutdown(): void {
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
    for (const timer of this.wanderTimers.values()) {
      timer.destroy();
    }
    this.wanderTimers.clear();
    this.cameraController.destroy();

    for (const agent of this.agents.values()) {
      agent.destroy(true);
    }
    this.agents.clear();
  }
}
