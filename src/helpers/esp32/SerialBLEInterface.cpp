#include "SerialBLEInterface.h"

// See the following for generating UUIDs:
// https://www.uuidgenerator.net/

#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E" // UART service UUID
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

#define ADVERT_RESTART_DELAY   1000 // millis

void SerialBLEInterface::begin(const char *device_name, uint32_t pin_code) {
  _pin_code = pin_code;

  // Create the BLE Device
  BLEDevice::init(device_name);
  BLEDevice::setMTU(MAX_FRAME_SIZE);

  // Only enable BLE security/pairing if a non-zero PIN is provided.
  // If PIN is 0 we leave the device open for connections without pairing.
  if (pin_code != 0) {
    BLEDevice::setSecurityCallbacks(this);
    BLESecurity sec;
    sec.setStaticPIN(pin_code);
    sec.setAuthenticationMode(ESP_LE_AUTH_REQ_SC_MITM_BOND);
  }

  // BLEDevice::setPower(ESP_PWR_LVL_N8);

  // Create the BLE Server
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(this);

  // Create the BLE Service
  pService = pServer->createService(SERVICE_UUID);

  // Create a BLE Characteristic
  pTxCharacteristic = pService->createCharacteristic(
      CHARACTERISTIC_UUID_TX, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);

  // RX characteristic supports both write with response and write without response
  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
      CHARACTERISTIC_UUID_RX, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);

  // Set permissions based on whether security is enabled
  if (pin_code != 0) {
    pTxCharacteristic->setAccessPermissions(ESP_GATT_PERM_READ_ENC_MITM);
    pRxCharacteristic->setAccessPermissions(ESP_GATT_PERM_WRITE_ENC_MITM);
  } else {
    // No encryption required - open access
    pTxCharacteristic->setAccessPermissions(ESP_GATT_PERM_READ);
    pRxCharacteristic->setAccessPermissions(ESP_GATT_PERM_WRITE);
  }

  pTxCharacteristic->addDescriptor(new BLE2902());
  pRxCharacteristic->setCallbacks(this);

  pServer->getAdvertising()->addServiceUUID(SERVICE_UUID);
}

// -------- BLESecurityCallbacks methods

uint32_t SerialBLEInterface::onPassKeyRequest() {
  BLE_DEBUG_PRINTLN("onPassKeyRequest()");
  return _pin_code;
}

void SerialBLEInterface::onPassKeyNotify(uint32_t pass_key) {
  BLE_DEBUG_PRINTLN("onPassKeyNotify(%u)", pass_key);
}

bool SerialBLEInterface::onConfirmPIN(uint32_t pass_key) {
  BLE_DEBUG_PRINTLN("onConfirmPIN(%u)", pass_key);
  return true;
}

bool SerialBLEInterface::onSecurityRequest() {
  BLE_DEBUG_PRINTLN("onSecurityRequest()");
  return true; // allow
}

void SerialBLEInterface::onAuthenticationComplete(esp_ble_auth_cmpl_t cmpl) {
  if (cmpl.success) {
    BLE_DEBUG_PRINTLN(" - SecurityCallback - Authentication Success");
    deviceConnected = true;
  } else {
    BLE_DEBUG_PRINTLN(" - SecurityCallback - Authentication Failure*");

    // pServer->removePeerDevice(pServer->getConnId(), true);
    pServer->disconnect(pServer->getConnId());
    adv_restart_time = millis() + ADVERT_RESTART_DELAY;
  }
}

// -------- BLEServerCallbacks methods

void SerialBLEInterface::onConnect(BLEServer *pServer) {
  // When no PIN/security is enabled, set deviceConnected here since
  // onAuthenticationComplete won't be called
  if (_pin_code == 0) {
    deviceConnected = true;
    BLE_DEBUG_PRINTLN("onConnect() - no PIN, setting deviceConnected = true");
  }
}

void SerialBLEInterface::onConnect(BLEServer *pServer, esp_ble_gatts_cb_param_t *param) {
  BLE_DEBUG_PRINTLN("onConnect(), conn_id=%d, mtu=%d", param->connect.conn_id,
                    pServer->getPeerMTU(param->connect.conn_id));
  last_conn_id = param->connect.conn_id;

  // When no PIN/security is enabled, set deviceConnected here since
  // onAuthenticationComplete won't be called
  if (_pin_code == 0) {
    deviceConnected = true;
    BLE_DEBUG_PRINTLN("onConnect() - no PIN, setting deviceConnected = true");
  }
}
void SerialBLEInterface::onMtuChanged(BLEServer *pServer, esp_ble_gatts_cb_param_t *param) {
  BLE_DEBUG_PRINTLN("onMtuChanged(), mtu=%d", pServer->getPeerMTU(param->mtu.conn_id));
}

void SerialBLEInterface::onDisconnect(BLEServer *pServer) {
  BLE_DEBUG_PRINTLN("onDisconnect()");
  if (_isEnabled) {
    adv_restart_time = millis() + ADVERT_RESTART_DELAY;

    // loop() will detect this on next loop, and set deviceConnected to false
  }
}

// -------- BLECharacteristicCallbacks methods

void SerialBLEInterface::onWrite(BLECharacteristic *pCharacteristic, esp_ble_gatts_cb_param_t *param) {
  uint8_t *rxValue = pCharacteristic->getData();
  int len = pCharacteristic->getLength();

  if (len > MAX_FRAME_SIZE) {
    BLE_DEBUG_PRINTLN("ERROR: onWrite(), frame too big, len=%d", len);
  } else {
    // If the recv queue is full, drop the oldest entry to make room for the new
    // incoming write. This favors newer frames (the app's latest commands)
    // over older ones when bursts occur.
    if (recv_queue_len >= FRAME_QUEUE_SIZE) {
      BLE_DEBUG_PRINTLN("WARN: onWrite(), recv_queue full - dropping oldest frame to make room");
      // shift left by one
      for (int i = 0; i < recv_queue_len - 1; i++) {
        recv_queue[i] = recv_queue[i + 1];
      }
      recv_queue_len--;
    }
    recv_queue[recv_queue_len].len = len;
    memcpy(recv_queue[recv_queue_len].buf, rxValue, len);
    recv_queue_len++;
  }
}

// ---------- public methods

void SerialBLEInterface::enable() {
  if (_isEnabled) return;

  _isEnabled = true;
  clearBuffers();

  // Start the service
  pService->start();

  // Start advertising

  // pServer->getAdvertising()->setMinInterval(500);
  // pServer->getAdvertising()->setMaxInterval(1000);

  pServer->getAdvertising()->start();
  adv_restart_time = 0;
}

void SerialBLEInterface::disable() {
  _isEnabled = false;

  BLE_DEBUG_PRINTLN("SerialBLEInterface::disable");

  pServer->getAdvertising()->stop();
  pServer->disconnect(last_conn_id);
  pService->stop();
  oldDeviceConnected = deviceConnected = false;
  adv_restart_time = 0;
}

size_t SerialBLEInterface::writeFrame(const uint8_t src[], size_t len) {
  if (len > MAX_FRAME_SIZE) {
    BLE_DEBUG_PRINTLN("writeFrame(), frame too big, len=%d", len);
    return 0;
  }

  if (deviceConnected && len > 0) {
    if (send_queue_len >= FRAME_QUEUE_SIZE) {
      BLE_DEBUG_PRINTLN("writeFrame(), send_queue is full!");
      return 0;
    }

    send_queue[send_queue_len].len = len; // add to send queue
    memcpy(send_queue[send_queue_len].buf, src, len);
    send_queue_len++;

    // Debug: log that we've enqueued a notify frame for the app
    BLE_DEBUG_PRINTLN("ENQUEUE_NOTIFY: len=%d hdr=0x%02x send_queue_len=%d", (uint32_t)len, (uint32_t)src[0],
                      (uint32_t)send_queue_len);

    return len;
  }
  // If not connected, log that notify was suppressed so we can correlate
  if (!deviceConnected) {
    BLE_DEBUG_PRINTLN("writeFrame(): device not connected - notify suppressed (len=%d hdr=0x%02x)",
                      (uint32_t)len, (uint32_t)(len > 0 ? src[0] : 0));
  }
  return 0;
}

#define BLE_WRITE_MIN_INTERVAL 60

bool SerialBLEInterface::isWriteBusy() const {
  return millis() < _last_write + BLE_WRITE_MIN_INTERVAL; // still too soon to start another write?
}

size_t SerialBLEInterface::checkRecvFrame(uint8_t dest[]) {
  if (send_queue_len > 0                                  // first, check send queue
      && millis() >= _last_write + BLE_WRITE_MIN_INTERVAL // space the writes apart
  ) {
    _last_write = millis();
    pTxCharacteristic->setValue(send_queue[0].buf, send_queue[0].len);
    pTxCharacteristic->notify();

    BLE_DEBUG_PRINTLN("writeBytes: sz=%d, hdr=%d", (uint32_t)send_queue[0].len,
                      (uint32_t)send_queue[0].buf[0]);

    send_queue_len--;
    for (int i = 0; i < send_queue_len; i++) { // delete top item from queue
      send_queue[i] = send_queue[i + 1];
    }
  }

  if (recv_queue_len > 0) {         // check recv queue
    size_t len = recv_queue[0].len; // take from top of queue
    uint8_t *buf = recv_queue[0].buf;

    // Parse framing: expect '<' + len_lsb + len_msb + payload
    // This matches the format sent by the companion app
    if (len >= 3 && buf[0] == '<') {
      uint16_t payload_len = buf[1] | (buf[2] << 8);
      if (payload_len > 0 && 3 + payload_len <= len && payload_len <= MAX_FRAME_SIZE) {
        memcpy(dest, &buf[3], payload_len);
        BLE_DEBUG_PRINTLN("readBytes (framed): sz=%d, hdr=%d", payload_len, (uint32_t)dest[0]);

        recv_queue_len--;
        for (int i = 0; i < recv_queue_len; i++) {
          recv_queue[i] = recv_queue[i + 1];
        }
        return payload_len;
      }
    }

    // Fallback: treat as raw unframed data (for backwards compatibility)
    if (len <= MAX_FRAME_SIZE) {
      memcpy(dest, buf, len);
      BLE_DEBUG_PRINTLN("readBytes (raw): sz=%d, hdr=%d", len, (uint32_t)dest[0]);
    }

    recv_queue_len--;
    for (int i = 0; i < recv_queue_len; i++) { // delete top item from queue
      recv_queue[i] = recv_queue[i + 1];
    }
    return len <= MAX_FRAME_SIZE ? len : 0;
  }

  if (pServer->getConnectedCount() == 0) deviceConnected = false;

  if (deviceConnected != oldDeviceConnected) {
    if (!deviceConnected) { // disconnecting
      clearBuffers();

      BLE_DEBUG_PRINTLN("SerialBLEInterface -> disconnecting...");

      // pServer->getAdvertising()->setMinInterval(500);
      // pServer->getAdvertising()->setMaxInterval(1000);

      adv_restart_time = millis() + ADVERT_RESTART_DELAY;
    } else {
      BLE_DEBUG_PRINTLN("SerialBLEInterface -> stopping advertising");
      BLE_DEBUG_PRINTLN("SerialBLEInterface -> connecting...");
      // connecting
      // do stuff here on connecting
      pServer->getAdvertising()->stop();
      adv_restart_time = 0;
    }
    oldDeviceConnected = deviceConnected;
  }

  if (adv_restart_time && millis() >= adv_restart_time) {
    if (pServer->getConnectedCount() == 0) {
      BLE_DEBUG_PRINTLN("SerialBLEInterface -> re-starting advertising");
      pServer->getAdvertising()->start(); // re-Start advertising
    }
    adv_restart_time = 0;
  }
  return 0;
}

bool SerialBLEInterface::isConnected() const {
  return deviceConnected; // pServer != NULL && pServer->getConnectedCount() > 0;
}

void SerialBLEInterface::setAdvertisementLobbyId(const char *lobbyId) {
  if (!pServer || !lobbyId) return;

  BLEAdvertising *pAdvertising = pServer->getAdvertising();

  // Create manufacturer data with lobby ID
  // Format: [0xFF, 0xFF] (placeholder company ID) + "L:" + lobbyId
  // Max BLE advert manufacturer data is ~26 bytes
  char mfgData[24];
  int len = snprintf(mfgData + 2, sizeof(mfgData) - 2, "L:%s", lobbyId);
  mfgData[0] = 0xFF; // Company ID low byte (0xFFFF = reserved for testing)
  mfgData[1] = 0xFF; // Company ID high byte

  BLEAdvertisementData advData;
  advData.setManufacturerData(std::string(mfgData, len + 2));
  advData.setCompleteServices(BLEUUID(SERVICE_UUID));

  pAdvertising->setAdvertisementData(advData);

  // Restart advertising with new data - EVEN while connected
  // This allows other phones to discover the lobby via BLE scan
  if (_isEnabled) {
    pAdvertising->stop();
    pAdvertising->start();
  }

  BLE_DEBUG_PRINTLN("Set advertisement lobby ID: %s", lobbyId);
}

void SerialBLEInterface::clearAdvertisementLobbyId() {
  if (!pServer) return;

  BLEAdvertising *pAdvertising = pServer->getAdvertising();

  // Reset to default advertisement (just service UUID)
  BLEAdvertisementData advData;
  advData.setCompleteServices(BLEUUID(SERVICE_UUID));
  pAdvertising->setAdvertisementData(advData);

  // Restart advertising - EVEN while connected
  if (_isEnabled) {
    pAdvertising->stop();
    pAdvertising->start();
  }

  BLE_DEBUG_PRINTLN("Cleared advertisement lobby ID");
}
