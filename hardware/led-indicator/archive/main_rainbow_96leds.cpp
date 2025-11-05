#include <Arduino.h>
#include <FastLED.h>

#define LED_PIN 6
#define NUM_LEDS 96
#define BRIGHTNESS 180
#define IDLE_FADE_MS 2000
#define SEND_DURATION_MS 10000
#define RAINBOW_STEP_MS 15
#define RAINBOW_HUE_STEP 4
#define RAINBOW_SPREAD 5

namespace {
  CRGB leds[NUM_LEDS];

  enum class LedState : uint8_t { Idle, Send, Off };
  LedState currentState = LedState::Idle;

  const CRGB COLOR_IDLE(0, 0, 255);
  const CRGB COLOR_SEND(255, 0, 0);
  const CRGB COLOR_OFF(0, 0, 0);

  CRGB currentColor = COLOR_OFF;
  bool fadeActive = false;
  CRGB fadeStartColor = COLOR_OFF;
  CRGB fadeEndColor = COLOR_OFF;
  unsigned long fadeStartMillis = 0;
  unsigned long fadeDurationMs = 0;
  unsigned long lastFadeUpdate = 0;
  unsigned long sendStartMillis = 0;
  unsigned long lastRainbowUpdate = 0;
  uint8_t rainbowHue = 0;

  void applyColor(const CRGB &color) {
    fadeActive = false;
    currentColor = color;
    fill_solid(leds, NUM_LEDS, color);
    FastLED.show();
  }

  void renderRainbow(bool force = false) {
    const unsigned long now = millis();
    if (!force && now - lastRainbowUpdate < RAINBOW_STEP_MS) return;
    lastRainbowUpdate = now;
    uint8_t hue = rainbowHue;
    for (uint16_t i = 0; i < NUM_LEDS; ++i) {
      const uint8_t brightness = 192 + (sin8(hue + i * 16) >> 3);
      leds[i] = CHSV(static_cast<uint8_t>(hue + i * RAINBOW_SPREAD), 255, brightness);
    }
    FastLED.show();
    rainbowHue += RAINBOW_HUE_STEP;
  }

  void beginFade(const CRGB &start, const CRGB &target, unsigned long durationMs) {
    fadeStartColor = start;
    fadeEndColor = target;
    if (fadeStartColor == fadeEndColor) {
      applyColor(target);
      return;
    }
    fadeStartMillis = millis();
    fadeDurationMs = durationMs ? durationMs : 1;
    fadeActive = true;
    lastFadeUpdate = 0;
    currentColor = start;
    fill_solid(leds, NUM_LEDS, start);
    FastLED.show();
  }

  void beginFade(const CRGB &target, unsigned long durationMs) {
    beginFade(currentColor, target, durationMs);
  }

  void tickFade() {
    if (!fadeActive) return;
    const unsigned long now = millis();
    if (now - lastFadeUpdate < 20) return;
    lastFadeUpdate = now;

    const unsigned long elapsed = now - fadeStartMillis;
    if (elapsed >= fadeDurationMs) {
      applyColor(fadeEndColor);
      return;
    }

    const uint8_t mix = static_cast<uint8_t>((elapsed * 255UL) / fadeDurationMs);
    const CRGB blended = blend(fadeStartColor, fadeEndColor, mix);
    currentColor = blended;
    fill_solid(leds, NUM_LEDS, blended);
    FastLED.show();
  }

  void setState(LedState next, bool immediate = false, bool restartIdleFade = false) {
    currentState = next;
    switch (currentState) {
      case LedState::Idle:
        if (immediate) {
          applyColor(COLOR_IDLE);
        } else {
          if (restartIdleFade) {
            CRGB dimBlue = COLOR_IDLE;
            dimBlue.nscale8_video(32);  // start almost dark for gentle fade-in
            beginFade(dimBlue, COLOR_IDLE, IDLE_FADE_MS);
          } else {
            beginFade(COLOR_IDLE, IDLE_FADE_MS);
          }
        }
        Serial.println(F("STATE:IDLE"));
        break;
      case LedState::Send:
        fadeActive = false;
        sendStartMillis = millis();
        lastRainbowUpdate = 0;
        rainbowHue = 0;
        renderRainbow(true);
        Serial.println(F("STATE:SEND"));
        break;
      case LedState::Off:
        applyColor(COLOR_OFF);
        Serial.println(F("STATE:OFF"));
        break;
    }
  }

  void handleCommand(char raw) {
    const char cmd = toupper(static_cast<unsigned char>(raw));
    switch (cmd) {
      case 'R':
        setState(LedState::Send, true);
        break;
      case 'B':
      case 'I':
        setState(LedState::Idle, false, true);
        break;
      case 'O':
        setState(LedState::Off, true);
        break;
      default:
        Serial.print(F("IGNORED:"));
        Serial.println(cmd);
        break;
    }
  }
}

namespace {
  void tickSend() {
    if (currentState != LedState::Send) return;
    const unsigned long now = millis();
    if (now - sendStartMillis >= SEND_DURATION_MS) {
      setState(LedState::Idle, true);
      return;
    }
    renderRainbow();
  }
}

void setup() {
  FastLED.addLeds<NEOPIXEL, LED_PIN>(leds, NUM_LEDS);
  FastLED.setBrightness(BRIGHTNESS);
  Serial.begin(115200);
  delay(50);
  setState(LedState::Idle, true);
  Serial.println(F("READY"));
}

void loop() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      continue;
    }
    handleCommand(c);
  }
  tickFade();
  tickSend();
}
