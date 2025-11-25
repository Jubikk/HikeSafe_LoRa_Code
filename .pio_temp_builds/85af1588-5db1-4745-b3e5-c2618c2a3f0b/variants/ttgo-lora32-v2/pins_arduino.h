// Minimal variant `pins_arduino.h` for ttgo-lora32-v2
// Provide a tiny, C-safe shim that defines the commonly expected
// pin macros (SDA, SCL, LED_BUILTIN) without including C++ headers.
// This avoids pulling <Arduino.h> into contexts that are inside
// `extern "C"` and causing template-with-C-linkage errors.

#ifndef PINS_ARDUINO_VARIANT_H
#define PINS_ARDUINO_VARIANT_H

// Default I2C pins for many ESP32 TTGO LoRa boards
#ifndef SDA
#define SDA 21
#endif

#ifndef SCL
#define SCL 22
#endif

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

// Common SPI pin defaults for ESP32 (VSPI)
#ifndef SCK
#define SCK 18
#endif

#ifndef MISO
#define MISO 19
#endif

#ifndef MOSI
#define MOSI 23
#endif

#ifndef SS
#define SS 5
#endif

#endif // PINS_ARDUINO_VARIANT_H
