import Phaser from "phaser";

interface MapIndex {
  maps: Array<{
    id: string;
    name: string;
    description: string;
    preview: string;
  }>;
  activeMap: string;
}

/**
 * BootScene — loads all world assets and shows a progress bar.
 * Reads maps/index.json to determine the active map, then loads
 * its config and assets from the corresponding map directory.
 * Transitions to WorldScene when loading is complete.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    const { width, height } = this.cameras.main;

    // --- Loading progress bar ---
    const barWidth = Math.min(width * 0.6, 400);
    const barHeight = 16;
    const barX = (width - barWidth) / 2;
    const barY = height / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x222244, 0.8);
    bg.fillRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4);

    const bar = this.add.graphics();
    this.load.on("progress", (value: number) => {
      bar.clear();
      bar.fillStyle(0x6c5ce7, 1);
      bar.fillRect(barX, barY, barWidth * value, barHeight);
    });

    const loadingText = this.add
      .text(width / 2, barY - 30, "Loading world...", {
        fontSize: "18px",
        color: "#cccccc",
      })
      .setOrigin(0.5);

    this.load.on("complete", () => {
      bg.destroy();
      bar.destroy();
      loadingText.destroy();
    });

    // --- Load map index to determine active map ---
    this.load.json("map-index", "assets/world/maps/index.json");
    this.load.on("filecomplete-json-map-index", () => {
      const mapIndex = this.cache.json.get("map-index") as MapIndex;
      const activeMapId = mapIndex?.activeMap ?? "map-1";
      const basePath = `assets/world/maps/${activeMapId}`;

      // --- Load world config from active map directory ---
      this.load.json("world-config", `${basePath}/config.json`);

      // --- Load images from active map directory ---
      this.load.image("world-bg", `${basePath}/background.png`);
      this.load.image("world-collision", `${basePath}/collision.png`);
    });

    // --- Load character sprite sheets (6 cols x 5 rows, 170x204 per frame) ---
    const frameWidth = 170;
    const frameHeight = 204;

    this.load.spritesheet(
      "character-default",
      "assets/world/sprites/default.png",
      { frameWidth, frameHeight }
    );

    this.load.spritesheet(
      "character-001",
      "assets/world/sprites/character-001.png",
      { frameWidth, frameHeight }
    );

    this.load.spritesheet(
      "character-002",
      "assets/world/sprites/character-002.png",
      { frameWidth, frameHeight }
    );

    this.load.spritesheet(
      "character-003",
      "assets/world/sprites/character-003.png",
      { frameWidth, frameHeight }
    );

    this.load.spritesheet(
      "character-004",
      "assets/world/sprites/character-004.png",
      { frameWidth, frameHeight }
    );
  }

  create(): void {
    this.scene.start("WorldScene");
  }
}
