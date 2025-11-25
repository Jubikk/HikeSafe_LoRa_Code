#ifndef PINS_ARDUINO_H
#define PINS_ARDUINO_H

// Minimal, C-safe compatibility shim. Do NOT include <Arduino.h> here
// because this header can be pulled in while an `extern "C"` block is
// active from core headers. Define only the small set of macros that
// libraries commonly expect when they include pins_arduino.h.

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

#endif // PINS_ARDUINO_H
