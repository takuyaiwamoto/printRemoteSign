#include <Arduino.h>
#include <FastLED.h>

#define LED_PIN 6
#define NUM_LEDS 60
#define BRIGHTNESS 160
#define COLOR_HOLD_MS 1000

CRGB leds[NUM_LEDS];

// Simple helper so the entire strip shows the same color.
static void fillStrip(const CRGB &color) {
  fill_solid(leds, NUM_LEDS, color);
  FastLED.show();
}

void setup() {
  FastLED.addLeds<NEOPIXEL, LED_PIN>(leds, NUM_LEDS);
  FastLED.setBrightness(BRIGHTNESS);
  fillStrip(CRGB::Black);  // Ensure we begin with LEDs off.
  delay(500);
}

void loop() {
  fillStrip(CRGB::Red);
  delay(COLOR_HOLD_MS);

  fillStrip(CRGB::Green);
  delay(COLOR_HOLD_MS);

  fillStrip(CRGB::Blue);
  delay(COLOR_HOLD_MS);

  fillStrip(CRGB::White);
  delay(COLOR_HOLD_MS);
}
