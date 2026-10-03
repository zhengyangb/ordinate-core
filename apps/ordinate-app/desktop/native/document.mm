#import <Cocoa/Cocoa.h>
#include <node_api.h>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <stdexcept>
#include <copyfile.h>
#include <cerrno>

// AppKit owns the document UI. The shared file session owns content, conflict
// detection and persistence. No second model, writer, timer or undo stack lives here.
@interface OrdinateDocument : NSDocument
@property(nonatomic) napi_threadsafe_function callback;
@property(nonatomic) NSUInteger sequence;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, id> *requests;
- (void)request:(NSString *)kind URL:(NSURL *)url completion:(void (^)(NSError *))completion;
@end

struct Event { NSUInteger id; std::string kind; std::string path; };
static NSError *DocumentError(NSString *message) {
  return [NSError errorWithDomain:@"dev.ordinate.document" code:1
                        userInfo:@{NSLocalizedDescriptionKey:message}];
}

// AppKit's default controller constructs a second NSDocument and synchronously
// reads it. Electron owns our windows/model, so open and Resume must instead wait
// for the existing asynchronous file session, then return its attached document.
@interface OrdinateDocumentController : NSDocumentController
@property(nonatomic) napi_threadsafe_function openCallback;
@property(nonatomic) NSUInteger openSequence;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, id> *openRequests;
@end

@implementation OrdinateDocumentController
- (instancetype)init {
  self = [super init];
  if ([self isKindOfClass:[OrdinateDocumentController class]]) self.openRequests = [NSMutableDictionary dictionary];
  return self;
}
- (void)openDocumentWithContentsOfURL:(NSURL *)url display:(BOOL)display completionHandler:(void (^)(NSDocument *, BOOL, NSError *))completion {
  [self reopenDocumentForURL:url withContentsOfURL:url display:display completionHandler:completion];
}
- (void)reopenDocumentForURL:(NSURL *)url withContentsOfURL:(NSURL *)contents display:(BOOL)display completionHandler:(void (^)(NSDocument *, BOOL, NSError *))completion {
  if (!url.isFileURL || ![url.URLByStandardizingPath isEqual:contents.URLByStandardizingPath]) {
    completion(nil, NO, DocumentError(@"Alternate AppKit recovery files are not supported. Ordinate restores drafts through its file session."));
    return;
  }
  if (!self.openCallback) { completion(nil, NO, DocumentError(@"The document opening service is unavailable.")); return; }
  NSUInteger identifier = ++self.openSequence;
  self.openRequests[@(identifier)] = [completion copy];
  auto event = new Event{identifier, "open", url.path.UTF8String};
  if (napi_call_threadsafe_function(self.openCallback, event, napi_tsfn_nonblocking) != napi_ok) {
    delete event;
    [self.openRequests removeObjectForKey:@(identifier)];
    completion(nil, NO, DocumentError(@"The document opening service has stopped."));
  }
}
@end

static OrdinateDocumentController *documentController;

@implementation OrdinateDocument
+ (BOOL)autosavesInPlace { return YES; }
+ (BOOL)autosavesDrafts { return NO; } // Durable untitled drafts belong to the shared session.
+ (BOOL)preservesVersions { return NO; }
+ (NSArray<NSString *> *)readableTypes { return @[@"dev.ordinate.document"]; }
+ (NSArray<NSString *> *)writableTypes { return self.readableTypes; }
+ (BOOL)isNativeType:(NSString *)type { return [type isEqual:@"dev.ordinate.document"]; }
- (NSString *)fileNameExtensionForType:(NSString *)type saveOperation:(NSSaveOperationType)operation { return @"ord"; }
- (instancetype)init {
  self = [super init];
  if (self) { self.requests = [NSMutableDictionary dictionary]; self.hasUndoManager = NO; self.fileType = @"dev.ordinate.document"; }
  return self;
}
- (void)scheduleAutosaving {} // The shared editor debounce is the sole periodic scheduler.
- (void)request:(NSString *)kind URL:(NSURL *)url completion:(void (^)(NSError *))completion {
  NSAssert([NSThread isMainThread], @"Document requests must run on the main thread");
  if (!self.callback) { completion(DocumentError(@"The document session has closed.")); return; }
  NSUInteger identifier = ++self.sequence;
  self.requests[@(identifier)] = [completion copy];
  auto event = new Event{identifier, kind.UTF8String, url ? url.path.UTF8String : ""};
  if (napi_call_threadsafe_function(self.callback, event, napi_tsfn_nonblocking) != napi_ok) {
    delete event;
    [self.requests removeObjectForKey:@(identifier)];
    completion(DocumentError(@"The document session is unavailable."));
  }
}
- (void)autosaveWithImplicitCancellability:(BOOL)cancellable completionHandler:(void (^)(NSError *))completion {
  [self request:@"flush" URL:nil completion:completion];
}
- (void)saveToURL:(NSURL *)url ofType:(NSString *)type forSaveOperation:(NSSaveOperationType)operation completionHandler:(void (^)(NSError *))completion {
  // The writer is asynchronous JS; using dataOfType: would require a stale copy
  // or block Electron's main thread. Explicitly delegate the entire operation.
  if (operation == NSSaveToOperation || operation == NSAutosaveElsewhereOperation || operation == NSAutosaveAsOperation) {
    completion(DocumentError(@"This save operation is not supported.")); return;
  }
  [self request:@"save" URL:url completion:^(NSError *error) {
    if (!error) {
      self.fileURL = url;
      self.fileType = type;
      self.fileModificationDate = [[NSFileManager defaultManager] attributesOfItemAtPath:url.path error:nil][NSFileModificationDate];
    }
    completion(error);
  }];
}
- (void)moveToURL:(NSURL *)url completionHandler:(void (^)(NSError *))completion {
  [self request:self.fileURL ? @"move" : @"save" URL:url completion:^(NSError *error) {
    if (!error) self.fileURL = url;
    if (completion) completion(error);
  }];
}
- (void)shouldCloseWindowController:(NSWindowController *)controller delegate:(id)delegate shouldCloseSelector:(SEL)selector contextInfo:(void *)context {
  // Let Electron's close event run the shared asynchronous flush, once. AppKit
  // must not present a second save/discard sheet before that event is reached.
  if (delegate && selector) {
    using Reply = void (*)(id, SEL, NSWindowController *, BOOL, void *);
    ((Reply)[delegate methodForSelector:selector])(delegate, selector, controller, YES, context);
  }
}
- (BOOL)validateUserInterfaceItem:(id<NSValidatedUserInterfaceItem>)item {
  SEL action = item.action;
  if (action == @selector(duplicateDocument:)) return YES;
  if (action == @selector(revertDocumentToSaved:) || action == @selector(browseDocumentVersions:)) return self.fileURL != nil;
  if (action == @selector(moveDocumentToUbiquityContainer:)) return NO;
  return [super validateUserInterfaceItem:item];
}
- (void)duplicateDocument:(id)sender {
  [self request:@"duplicate" URL:nil completion:^(NSError *error) { if (error) [self presentError:error]; }];
}
- (void)revertDocumentToSaved:(id)sender {
  [self request:@"revert" URL:nil completion:^(NSError *error) { if (error) [self presentError:error]; }];
}
- (void)browseDocumentVersions:(id)sender { [self revertDocumentToSaved:sender]; }
@end

struct Host { __strong OrdinateDocument *document; __strong NSWindowController *controller; };
static std::map<uint32_t, std::unique_ptr<Host>> hosts;
static uint32_t nextHost = 0;

static void Check(napi_status status) { if (status != napi_ok) throw std::runtime_error("Invalid native document argument"); }
static std::string String(napi_env env, napi_value value) {
  size_t size; Check(napi_get_value_string_utf8(env, value, nullptr, 0, &size));
  std::string result(size + 1, '\0');
  Check(napi_get_value_string_utf8(env, value, result.data(), result.size(), &size)); result.resize(size); return result;
}
static napi_value JSString(napi_env env, const std::string &text) {
  napi_value value; Check(napi_create_string_utf8(env, text.c_str(), text.size(), &value)); return value;
}
static napi_value Number(napi_env env, uint32_t number) {
  napi_value value; Check(napi_create_uint32(env, number, &value)); return value;
}
static Host &GetHost(napi_env env, napi_value value) {
  uint32_t identifier; Check(napi_get_value_uint32(env, value, &identifier));
  auto found = hosts.find(identifier);
  if (found == hosts.end()) throw std::runtime_error("Unknown native document");
  return *found->second;
}
static void Deliver(napi_env env, napi_value callback, void *, void *data) {
  std::unique_ptr<Event> event(static_cast<Event *>(data));
  if (!env) return;
  napi_value args[] = {Number(env, (uint32_t)event->id), JSString(env, event->kind), JSString(env, event->path)};
  napi_value receiver, result; napi_get_undefined(env, &receiver);
  napi_call_function(env, receiver, callback, 3, args, &result);
}

using Action = napi_value (*)(napi_env, napi_value *);
static napi_value Invoke(napi_env env, napi_callback_info info) {
  try {
    if (![NSThread isMainThread]) throw std::runtime_error("AppKit requires the main thread");
    size_t count = 4; napi_value args[4] = {}; void *action;
    Check(napi_get_cb_info(env, info, &count, args, nullptr, &action));
    @try { return ((Action)action)(env, args); }
    @catch (NSException *error) { napi_throw_error(env, nullptr, error.reason.UTF8String); return nullptr; }
  } catch (const std::exception &error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
}
static napi_value Attach(napi_env env, napi_value *args) {
  bool buffer; Check(napi_is_buffer(env, args[0], &buffer));
  if (!buffer) throw std::runtime_error("Expected native window handle");
  void *data; size_t length; Check(napi_get_buffer_info(env, args[0], &data, &length));
  if (length != sizeof(NSView *)) throw std::runtime_error("Invalid native window handle");
  __unsafe_unretained NSView *view; std::memcpy(&view, data, length);
  NSWindow *window = view.window;
  if (!window || window.windowController) throw std::runtime_error("Window already belongs to a controller");
  auto host = std::make_unique<Host>();
  host->document = [[OrdinateDocument alloc] init];
  napi_threadsafe_function callback;
  Check(napi_create_threadsafe_function(env, args[1], nullptr, JSString(env, "OrdinateDocument"), 0, 1, nullptr, nullptr, nullptr, Deliver, &callback));
  Check(napi_unref_threadsafe_function(env, callback));
  host->document.callback = callback;
  id previousDelegate = window.delegate;
  host->controller = [[NSWindowController alloc] initWithWindow:window];
  [host->document addWindowController:host->controller];
  // Electron continues to own close, resize and fullscreen callbacks.
  window.delegate = previousDelegate;
  [[NSDocumentController sharedDocumentController] addDocument:host->document];
  uint32_t identifier = ++nextHost;
  hosts.emplace(identifier, std::move(host));
  return Number(env, identifier);
}
static napi_value Update(napi_env env, napi_value *args) {
  Host &host = GetHost(env, args[0]);
  std::string path = String(env, args[1]); bool edited; Check(napi_get_value_bool(env, args[2], &edited));
  NSURL *url = path.empty() ? nil : [NSURL fileURLWithPath:@(path.c_str())];
  if (![host.document.fileURL isEqual:url]) host.document.fileURL = url;
  if (!url) host.document.displayName = @"Untitled";
  if (host.document.isDocumentEdited != edited) [host.document updateChangeCount:edited ? NSChangeDone : NSChangeCleared];
  // AppKit gates this entire button on preservesVersions, but its rename/move
  // actions also work without a version browser. Enable the public system button;
  // unsupported version/duplicate commands are disabled by document validation.
  [host.controller.window standardWindowButton:NSWindowDocumentVersionsButton].enabled = YES;
  return nullptr;
}
static napi_value Complete(napi_env env, napi_value *args) {
  Host &host = GetHost(env, args[0]); uint32_t identifier; Check(napi_get_value_uint32(env, args[1], &identifier));
  void (^completion)(NSError *) = host.document.requests[@(identifier)];
  if (!completion) throw std::runtime_error("Unknown document request");
  std::string error = String(env, args[2]);
  [host.document.requests removeObjectForKey:@(identifier)];
  completion(error.empty() ? nil : DocumentError(@(error.c_str())));
  return nullptr;
}
static napi_value Detach(napi_env env, napi_value *args) {
  Host &host = GetHost(env, args[0]); uint32_t identifier; Check(napi_get_value_uint32(env, args[0], &identifier));
  for (void (^completion)(NSError *) in host.document.requests.allValues) completion(DocumentError(@"Document closed."));
  [host.document.requests removeAllObjects];
  napi_release_threadsafe_function(host.document.callback, napi_tsfn_abort); host.document.callback = nullptr;
  host.controller.window.windowController = nil;
  [host.document removeWindowController:host.controller];
  [host.controller setWindow:nil];
  [host.document close];
  hosts.erase(identifier);
  return nullptr;
}
static napi_value MoveFile(napi_env env, napi_value *args) {
  Host &host = GetHost(env, args[0]);
  std::string from = String(env, args[1]), to = String(env, args[2]);
  NSURL *source = [NSURL fileURLWithPath:@(from.c_str())], *target = [NSURL fileURLWithPath:@(to.c_str())];
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:host.document];
  __block NSError *moveError = nil; NSError *coordinationError = nil;
  [coordinator coordinateWritingItemAtURL:source options:NSFileCoordinatorWritingForMoving
                        writingItemAtURL:target options:0 error:&coordinationError byAccessor:^(NSURL *oldURL, NSURL *newURL) {
    // NSFileManager refuses to overwrite an existing item, including races.
    if ([[NSFileManager defaultManager] moveItemAtURL:oldURL toURL:newURL error:&moveError])
      [coordinator itemAtURL:oldURL didMoveToURL:newURL];
  }];
  NSError *error = coordinationError ?: moveError;
  if (error) throw std::runtime_error(error.localizedDescription.UTF8String);
  return nullptr;
}
static napi_value CopyMetadata(napi_env env, napi_value *args) {
  std::string source = String(env, args[0]), replacement = String(env, args[1]);
  if (copyfile(source.c_str(), replacement.c_str(), nullptr, COPYFILE_XATTR) != 0)
    throw std::runtime_error(std::strerror(errno));
  return nullptr;
}
static napi_value DocumentAction(napi_env env, napi_value *args) {
  Host &host = GetHost(env, args[0]);
  std::string action = String(env, args[1]);
  if (action == "rename") [host.document renameDocument:nil];
  else if (action == "move") [host.document moveDocument:nil];
  else throw std::runtime_error("Unknown document action");
  return nullptr;
}
static napi_value Checkpoint(napi_env env, napi_value *args) {
  std::string filename = String(env, args[0]);
  NSURL *url = [NSURL fileURLWithPath:@(filename.c_str())];
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  __block NSError *versionError = nil; NSError *coordinationError = nil;
  [coordinator coordinateWritingItemAtURL:url options:0 error:&coordinationError byAccessor:^(NSURL *location) {
    [NSFileVersion addVersionOfItemAtURL:location withContentsOfURL:location options:0 error:&versionError];
  }];
  NSError *error = coordinationError ?: versionError;
  if (error) throw std::runtime_error(error.localizedDescription.UTF8String);
  return nullptr;
}
static NSArray<NSFileVersion *> *Versions(NSURL *url) {
  return [[NSFileVersion otherVersionsOfItemAtURL:url] sortedArrayUsingComparator:^NSComparisonResult(NSFileVersion *a, NSFileVersion *b) {
    return [b.modificationDate compare:a.modificationDate];
  }];
}
static NSString *VersionIdentifier(NSFileVersion *version) {
  NSError *error = nil;
  NSData *data = [NSKeyedArchiver archivedDataWithRootObject:version.persistentIdentifier requiringSecureCoding:NO error:&error];
  if (!data) throw std::runtime_error(error.localizedDescription.UTF8String);
  return [data base64EncodedStringWithOptions:0];
}
static napi_value ListVersions(napi_env env, napi_value *args) {
  std::string filename = String(env, args[0]);
  NSArray<NSFileVersion *> *versions = Versions([NSURL fileURLWithPath:@(filename.c_str())]);
  napi_value result; Check(napi_create_array_with_length(env, versions.count, &result));
  NSUInteger index = 0;
  NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
  for (NSFileVersion *version in versions) {
    napi_value item; Check(napi_create_object(env, &item));
    Check(napi_set_named_property(env, item, "id", JSString(env, VersionIdentifier(version).UTF8String)));
    Check(napi_set_named_property(env, item, "date", JSString(env, [formatter stringFromDate:version.modificationDate].UTF8String)));
    Check(napi_set_element(env, result, (uint32_t)index++, item));
  }
  return result;
}
static napi_value ReadVersion(napi_env env, napi_value *args) {
  std::string filename = String(env, args[0]), identifier = String(env, args[1]);
  NSFileVersion *selected = nil;
  for (NSFileVersion *version in Versions([NSURL fileURLWithPath:@(filename.c_str())])) {
    if ([VersionIdentifier(version) isEqualToString:@(identifier.c_str())]) { selected = version; break; }
  }
  if (!selected) throw std::runtime_error("The selected version is no longer available");
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  __block NSString *text = nil; __block NSError *readError = nil; NSError *coordinationError = nil;
  [coordinator coordinateReadingItemAtURL:selected.URL options:0 error:&coordinationError byAccessor:^(NSURL *url) {
    text = [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:&readError];
  }];
  NSError *error = coordinationError ?: readError;
  if (error) throw std::runtime_error(error.localizedDescription.UTF8String);
  if (!text) throw std::runtime_error("Could not read the selected version");
  return JSString(env, text.UTF8String);
}
static napi_value SetOpenHandler(napi_env env, napi_value *args) {
  if (documentController.openCallback) throw std::runtime_error("Document opening handler is already installed");
  napi_threadsafe_function callback;
  Check(napi_create_threadsafe_function(env, args[0], nullptr, JSString(env, "DocumentOpen"), 0, 1, nullptr, nullptr, nullptr, Deliver, &callback));
  Check(napi_unref_threadsafe_function(env, callback));
  documentController.openCallback = callback;
  return nullptr;
}
static napi_value CompleteOpen(napi_env env, napi_value *args) {
  uint32_t identifier; Check(napi_get_value_uint32(env, args[0], &identifier));
  void (^completion)(NSDocument *, BOOL, NSError *) = documentController.openRequests[@(identifier)];
  if (!completion) throw std::runtime_error("Unknown document opening request");
  std::string error = String(env, args[2]);
  OrdinateDocument *document = error.empty() ? GetHost(env, args[1]).document : nil;
  [documentController.openRequests removeObjectForKey:@(identifier)];
  completion(document, NO, error.empty() ? nil : DocumentError(@(error.c_str())));
  return nullptr;
}
#ifdef ORDINATE_NATIVE_TEST
// Test-only entry points invoke the real NSDocument API on a hidden test window.
// They are never included in the production addon or renderer bridge.
static napi_value TestOperation(napi_env env, napi_value *args) {
  Host &host = GetHost(env, args[0]);
  std::string kind = String(env, args[1]), path = String(env, args[2]);
  napi_threadsafe_function completion;
  Check(napi_create_threadsafe_function(env, args[3], nullptr, JSString(env, "DocumentTest"), 0, 1, nullptr, nullptr, nullptr, Deliver, &completion));
  void (^finished)(NSError *) = ^(NSError *error) {
    napi_call_threadsafe_function(completion, new Event{0, error ? error.localizedDescription.UTF8String : "", ""}, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(completion, napi_tsfn_release);
  };
  NSURL *url = [NSURL fileURLWithPath:@(path.c_str())];
  if (kind == "save") [host.document saveToURL:url ofType:@"dev.ordinate.document" forSaveOperation:NSSaveAsOperation completionHandler:finished];
  else if (kind == "move") [host.document moveToURL:url completionHandler:finished];
  else if (kind == "flush") [host.document autosaveWithImplicitCancellability:NO completionHandler:finished];
  else if (kind == "reopen" || kind == "open") {
    void (^opened)(NSDocument *, BOOL, NSError *) = ^(NSDocument *document, BOOL alreadyOpen, NSError *error) {
      if (!error && document != host.document) error = DocumentError(@"Opening created a second document");
      finished(error);
    };
    if (kind == "reopen") [[NSDocumentController sharedDocumentController] reopenDocumentForURL:url withContentsOfURL:url display:NO completionHandler:opened];
    else [[NSDocumentController sharedDocumentController] openDocumentWithContentsOfURL:url display:NO completionHandler:opened];
  }
  else throw std::runtime_error("Unknown test operation");
  return nullptr;
}
#endif
void RegisterDocuments(napi_env env, napi_value exports) {
  // The first controller becomes AppKit's shared instance. Install before ready,
  // not after creating a window: Resume can arrive during application launching.
  documentController = [[OrdinateDocumentController alloc] init];
  if (![documentController isKindOfClass:[OrdinateDocumentController class]] || [NSDocumentController sharedDocumentController] != documentController) {
    napi_throw_error(env, nullptr, "Document controller must be installed before AppKit restoration starts");
    return;
  }
  const struct { const char *name; Action action; } methods[] = {
    {"setDocumentOpenHandler", SetOpenHandler}, {"completeDocumentOpen", CompleteOpen},
    {"attachDocument", Attach}, {"updateDocument", Update}, {"completeDocumentRequest", Complete},
    {"detachDocument", Detach}, {"moveDocumentFile", MoveFile},
    {"copyDocumentMetadata", CopyMetadata},
    {"documentAction", DocumentAction}, {"checkpoint", Checkpoint},
    {"listVersions", ListVersions}, {"readVersion", ReadVersion},
#ifdef ORDINATE_NATIVE_TEST
    {"testOperation", TestOperation},
#endif
  };
  for (const auto &method : methods) {
    napi_value function; Check(napi_create_function(env, method.name, NAPI_AUTO_LENGTH, Invoke, (void *)method.action, &function));
    Check(napi_set_named_property(env, exports, method.name, function));
  }
}
