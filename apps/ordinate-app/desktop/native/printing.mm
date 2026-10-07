#import <Cocoa/Cocoa.h>
#import <PDFKit/PDFKit.h>
#include <node_api.h>
#include <cstring>
#include <memory>
#include <string>
#include <stdexcept>

// The renderer never supplies native handles, PDFs or paths. The main process
// hands PDFKit a copy of Chromium's complete, already-paginated sheet snapshot.
static void Check(napi_status status) {
  if (status != napi_ok) throw std::runtime_error("Invalid native printing argument");
}
static NSString *String(napi_env env, napi_value value) {
  size_t size; Check(napi_get_value_string_utf8(env, value, nullptr, 0, &size));
  std::string text(size + 1, '\0');
  Check(napi_get_value_string_utf8(env, value, text.data(), text.size(), &size));
  return [[NSString alloc] initWithBytes:text.data() length:size encoding:NSUTF8StringEncoding];
}
static void *Buffer(napi_env env, napi_value value, size_t &length) {
  bool buffer; Check(napi_is_buffer(env, value, &buffer));
  if (!buffer) throw std::runtime_error("Expected a printing buffer");
  void *data; Check(napi_get_buffer_info(env, value, &data, &length));
  return data;
}
static NSWindow *Window(napi_env env, napi_value value) {
  size_t length; void *data = Buffer(env, value, length);
  if (length != sizeof(NSView *)) throw std::runtime_error("Invalid native window handle");
  __unsafe_unretained NSView *view; std::memcpy(&view, data, length);
  if (!view.window) throw std::runtime_error("The document window has closed");
  return view.window;
}
static PDFDocument *Document(napi_env env, napi_value value) {
  size_t length; void *bytes = Buffer(env, value, length);
  if (!length) throw std::runtime_error("The printable PDF is empty");
  PDFDocument *document = [[PDFDocument alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
  if (!document || document.isLocked || !document.pageCount)
    throw std::runtime_error("The printable PDF is invalid or locked");
  return document;
}
static NSPrintOperation *Operation(PDFDocument *document, NSString *title) {
  NSPrintInfo *info = [NSPrintInfo.sharedPrintInfo copy];
  NSPrintOperation *operation = [document printOperationForPrintInfo:info
    scalingMode:kPDFPrintPageScaleDownToFit autoRotate:YES];
  if (!operation) throw std::runtime_error("Cannot prepare the native PDF print operation");
  operation.jobTitle = title;
  operation.showsPrintPanel = YES;
  operation.showsProgressPanel = YES;
  operation.printPanel.options |= NSPrintPanelShowsPreview | NSPrintPanelShowsPaperSize |
    NSPrintPanelShowsOrientation | NSPrintPanelShowsScaling | NSPrintPanelShowsPageRange;
  return operation;
}

struct Result { std::string error; bool printed; };
static void Deliver(napi_env env, napi_value callback, void *, void *data) {
  std::unique_ptr<Result> result(static_cast<Result *>(data));
  if (!env) return;
  napi_value args[2], receiver, ignored;
  Check(napi_create_string_utf8(env, result->error.c_str(), result->error.size(), &args[0]));
  Check(napi_get_boolean(env, result->printed, &args[1]));
  Check(napi_get_undefined(env, &receiver));
  napi_call_function(env, receiver, callback, 2, args, &ignored);
}

@interface OrdinatePrintJob : NSObject
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) PDFDocument *document;
@property(nonatomic, strong) NSPrintOperation *operation;
@property(nonatomic) napi_threadsafe_function callback;
- (void)finish:(NSString *)error printed:(BOOL)printed;
- (void)didRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)context;
@end
static NSMutableDictionary<NSNumber *, OrdinatePrintJob *> *jobs;
@implementation OrdinatePrintJob
- (void)finish:(NSString *)error printed:(BOOL)printed {
  auto result = new Result{error.UTF8String, (bool)printed};
  if (napi_call_threadsafe_function(self.callback, result, napi_tsfn_nonblocking) != napi_ok) delete result;
  napi_release_threadsafe_function(self.callback, napi_tsfn_release);
  self.callback = nullptr;
  [jobs removeObjectForKey:@(self.window.windowNumber)];
}
- (void)didRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)context {
  // AppKit presents printer errors itself; NO also denotes a user cancellation.
  [self finish:@"" printed:success];
}
@end

using Action = napi_value (*)(napi_env, napi_value *);
static napi_value Invoke(napi_env env, napi_callback_info info) {
  try {
    if (!NSThread.isMainThread) throw std::runtime_error("Printing requires the main thread");
    size_t count = 4; napi_value args[4] = {}; void *action;
    Check(napi_get_cb_info(env, info, &count, args, nullptr, &action));
    @try { return ((Action)action)(env, args); }
    @catch (NSException *error) { napi_throw_error(env, nullptr, error.reason.UTF8String); return nullptr; }
  } catch (const std::exception &error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
}
static napi_value PrintPDF(napi_env env, napi_value *args) {
  NSWindow *window = Window(env, args[0]);
  if (jobs[@(window.windowNumber)]) throw std::runtime_error("A print operation is already in progress");
  if (window.attachedSheet) throw std::runtime_error("Close the current system dialog before printing");
  OrdinatePrintJob *job = [[OrdinatePrintJob alloc] init];
  job.window = window;
  job.document = Document(env, args[1]);
  job.operation = Operation(job.document, String(env, args[2]));
  napi_value name; Check(napi_create_string_utf8(env, "OrdinatePrint", NAPI_AUTO_LENGTH, &name));
  napi_threadsafe_function callback;
  Check(napi_create_threadsafe_function(env, args[3], nullptr, name, 0, 1, nullptr, nullptr, nullptr, Deliver, &callback));
  job.callback = callback;
  jobs[@(window.windowNumber)] = job;
  // Leave the Node-API invocation before AppKit opens its native sheet/run loop.
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      [job.operation runOperationModalForWindow:window delegate:job
        didRunSelector:@selector(didRun:success:contextInfo:) contextInfo:nullptr];
    } @catch (NSException *error) { [job finish:error.reason printed:NO]; }
  });
  return nullptr;
}

#ifdef ORDINATE_NATIVE_TEST
static napi_value TestConfiguration(napi_env env, napi_value *args) {
  PDFDocument *document = Document(env, args[0]);
  NSPrintOperation *operation = Operation(document, @"Print preview test");
  napi_value result, value; Check(napi_create_object(env, &result));
  Check(napi_create_uint32(env, (uint32_t)document.pageCount, &value));
  Check(napi_set_named_property(env, result, "pages", value));
  Check(napi_get_boolean(env, operation.showsPrintPanel && (operation.printPanel.options & NSPrintPanelShowsPreview), &value));
  Check(napi_set_named_property(env, result, "preview", value));
  return result;
}
static napi_value TestCancel(napi_env env, napi_value *args) {
  NSWindow *window = Window(env, args[0]);
  if (!jobs[@(window.windowNumber)] || !window.attachedSheet)
    throw std::runtime_error("The test print sheet has not opened");
  [NSApp endSheet:window.attachedSheet returnCode:NSModalResponseCancel];
  return nullptr;
}
#endif
void RegisterPrinting(napi_env env, napi_value exports) {
  jobs = [NSMutableDictionary dictionary];
  const struct { const char *name; Action action; } methods[] = {
    {"printPDF", PrintPDF},
#ifdef ORDINATE_NATIVE_TEST
    {"testPrintConfiguration", TestConfiguration}, {"testCancelPrint", TestCancel},
#endif
  };
  for (const auto &method : methods) {
    napi_value function; Check(napi_create_function(env, method.name, NAPI_AUTO_LENGTH, Invoke, (void *)method.action, &function));
    Check(napi_set_named_property(env, exports, method.name, function));
  }
}
