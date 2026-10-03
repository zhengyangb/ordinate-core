#import <Cocoa/Cocoa.h>
#include <node_api.h>
#include <cstring>
#include <cmath>

// Only called in Electron's main process with its own getNativeWindowHandle().
// No pointer or native window capability is exposed to the renderer.
static napi_value SetChrome(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value args[4];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 4) {
    napi_throw_type_error(env, nullptr, "Expected a window handle and three sRGB channels");
    return nullptr;
  }
  bool isBuffer = false;
  void* data = nullptr;
  size_t length = 0;
  if (napi_is_buffer(env, args[0], &isBuffer) != napi_ok || !isBuffer ||
      napi_get_buffer_info(env, args[0], &data, &length) != napi_ok || length != sizeof(NSView*)) {
    napi_throw_type_error(env, nullptr, "Invalid native window handle");
    return nullptr;
  }
  double rgb[3];
  for (int i = 0; i < 3; ++i) {
    if (napi_get_value_double(env, args[i + 1], &rgb[i]) != napi_ok ||
        !std::isfinite(rgb[i]) || rgb[i] < 0 || rgb[i] > 255) {
      napi_throw_type_error(env, nullptr, "Invalid sRGB channel");
      return nullptr;
    }
  }
  if (![NSThread isMainThread]) {
    napi_throw_error(env, nullptr, "Window appearance must run on the main thread");
    return nullptr;
  }
  __unsafe_unretained NSView* view;
  std::memcpy(&view, data, sizeof(view));
  NSWindow* window = view.window;
  if (!window) {
    napi_throw_error(env, nullptr, "Native view has no window");
    return nullptr;
  }
  window.titlebarAppearsTransparent = YES;
  window.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;
  window.backgroundColor = [NSColor colorWithSRGBRed:rgb[0] / 255.0
                                             green:rgb[1] / 255.0
                                              blue:rgb[2] / 255.0 alpha:1.0];
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

void RegisterDocuments(napi_env env, napi_value exports);
NAPI_MODULE_INIT() {
  napi_value callback;
  if (napi_create_function(env, "setChrome", NAPI_AUTO_LENGTH, SetChrome, nullptr, &callback) != napi_ok ||
      napi_set_named_property(env, exports, "setChrome", callback) != napi_ok) {
    napi_throw_error(env, nullptr, "Cannot initialize native titlebar bridge");
    return nullptr;
  }
  RegisterDocuments(env, exports);
  return exports;
}
