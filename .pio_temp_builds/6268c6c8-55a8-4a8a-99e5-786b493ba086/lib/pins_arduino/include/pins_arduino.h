// Compatibility shim library to provide pins_arduino.h to core and other libraries
// Provide a minimal, C-safe header that defines common pin macros.
#ifndef PINS_ARDUINO_H
#define PINS_ARDUINO_H

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
