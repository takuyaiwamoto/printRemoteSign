#include <Arduino.h>
#include <FastLED.h>

#define LED_PIN 6
#define NUM_LEDS 96
#define BRIGHTNESS 200
#define WAIT_BEFORE_FADE_MS 3000
#define FADE_DURATION_MS 10000
#define HOLD_DURATION_MS 2000

namespace {
  CRGB leds[NUM_LEDS];

  enum class Stage : uint8_t { Wait, Fade, Hold };
  Stage stage = Stage::Wait;
  unsigned long stageStartMs = 0;

  void showColor(const CRGB &color) {
    fill_solid(leds, NUM_LEDS, color);
    FastLED.show();
  }
}

void setup() {
  FastLED.addLeds<NEOPIXEL, LED_PIN>(leds, NUM_LEDS);
  FastLED.setBrightness(BRIGHTNESS);
  showColor(CRGB::Black);
  stageStartMs = millis();
}

void loop() {
  const unsigned long now = millis();

  switch (stage) {
    case Stage::Wait:
      if (now - stageStartMs >= WAIT_BEFORE_FADE_MS) {
        stage = Stage::Fade;
        stageStartMs = now;
      }
      break;

    case Stage::Fade: {
      const unsigned long elapsed = now - stageStartMs;
      if (elapsed >= FADE_DURATION_MS) {
        showColor(CRGB(0, 0, 255));
        stage = Stage::Hold;
        break;
      }

      const uint8_t intensity = static_cast<uint8_t>((elapsed * 255UL) / FADE_DURATION_MS);
      showColor(CRGB(0, 0, intensity));
      break;
    }

    case Stage::Hold:
      if (now - stageStartMs >= HOLD_DURATION_MS) {
        stage = Stage::Wait;
        stageStartMs = now;
        showColor(CRGB::Black);
      }
      break;
  }

  delay(20);
}
