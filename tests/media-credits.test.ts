import { describe, it, expect } from "vitest";
import { mediaCredits } from "@/lib/media-credits";

const FLUX = {
  media_base_credits: 150,
  media_base_pixels: 1024 * 1024,
  media_base_steps: 20,
  media_base_frames: null,
};

const WAN = {
  media_base_credits: 500,
  media_base_pixels: 1280 * 704,
  media_base_steps: 30,
  media_base_frames: 49,
};

describe("mediaCredits", () => {
  it("cobra el precio base en la configuración de referencia", () => {
    expect(mediaCredits(FLUX, { width: 1024, height: 1024, steps: 20 })).toBe(150);
  });

  it("escala con los píxeles", () => {
    // El doble de área = el doble de créditos.
    expect(mediaCredits(FLUX, { width: 1024, height: 2048, steps: 20 })).toBe(300);
  });

  it("escala con los steps", () => {
    expect(mediaCredits(FLUX, { width: 1024, height: 1024, steps: 40 })).toBe(300);
    expect(mediaCredits(FLUX, { width: 1024, height: 1024, steps: 10 })).toBe(75);
  });

  it("multiplica por el batch", () => {
    expect(mediaCredits(FLUX, { width: 1024, height: 1024, steps: 20, batch: 3 })).toBe(450);
  });

  it("escala video con los frames", () => {
    expect(mediaCredits(WAN, { width: 1280, height: 704, steps: 30, frames: 49 })).toBe(500);
    expect(mediaCredits(WAN, { width: 1280, height: 704, steps: 30, frames: 121 })).toBe(1235);
  });

  it("nunca devuelve 0 para un job que sí corrió", () => {
    expect(mediaCredits(FLUX, { width: 256, height: 256, steps: 1 })).toBe(1);
  });

  it("devuelve 0 solo si el modelo no tiene precio configurado", () => {
    expect(
      mediaCredits({ media_base_credits: 0 }, { width: 1024, height: 1024, steps: 20 }),
    ).toBe(0);
  });

  it("ignora factores cuya referencia falta en vez de dividir por cero", () => {
    const sinReferencias = { media_base_credits: 40 };
    expect(mediaCredits(sinReferencias, { width: 1024, height: 1024, steps: 20 })).toBe(40);
  });
});
