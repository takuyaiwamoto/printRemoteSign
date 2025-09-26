#include <Arduino.h>
#include <FastLED.h>

#define LED_PIN 6
#define NUM_LEDS 60
#define BRIGHTNESS 180

namespace {
  CRGB leds[NUM_LEDS];

  enum class LedState : uint8_t { Idle, Send, Off };
  LedState currentState = LedState::Idle;

  const CRGB COLOR_IDLE(0, 0, 255);
  const CRGB COLOR_SEND(255, 0, 0);
  const CRGB COLOR_OFF(0, 0, 0);

  void applyColor(const CRGB &color) {
    fill_solid(leds, NUM_LEDS, color);
    FastLED.show();
  }

  void setState(LedState next) {
    currentState = next;
    switch (currentState) {
      case LedState::Idle:
        applyColor(COLOR_IDLE);
        Serial.println(F("STATE:IDLE"));
        break;
      case LedState::Send:
        applyColor(COLOR_SEND);
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
        setState(LedState::Send);
        break;
      case 'B':
      case 'I':
        setState(LedState::Idle);
        break;
      case 'O':
        setState(LedState::Off);
        break;
      default:
        Serial.print(F("IGNORED:"));
        Serial.println(cmd);
        break;
    }
  }
}

void setup() {
  FastLED.addLeds<NEOPIXEL, LED_PIN>(leds, NUM_LEDS);
  FastLED.setBrightness(BRIGHTNESS);
  Serial.begin(115200);
  delay(50);
  setState(LedState::Idle);
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
}
