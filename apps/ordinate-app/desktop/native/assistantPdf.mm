#import <Cocoa/Cocoa.h>
#import <PDFKit/PDFKit.h>
#include <node_api.h>
#include <stdexcept>
#include <string>

static void Check(napi_status status) {
  if (status != napi_ok) throw std::runtime_error("Cannot prepare assistant PDF input");
}

static napi_value ExtractAssistantPDF(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 1;
    napi_value argument;
    Check(napi_get_cb_info(env, info, &argc, &argument, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("Expected one PDF buffer");
    bool isBuffer;
    Check(napi_is_buffer(env, argument, &isBuffer));
    if (!isBuffer) throw std::runtime_error("Expected a PDF buffer");
    void *bytes;
    size_t length;
    Check(napi_get_buffer_info(env, argument, &bytes, &length));
    PDFDocument *document = [[PDFDocument alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
    if (!document || document.isLocked || !document.pageCount) throw std::runtime_error("The PDF is invalid or locked");
    if (document.pageCount > 12) throw std::runtime_error("Attach a PDF with 12 pages or fewer");

    napi_value result, images, pageCount;
    Check(napi_create_object(env, &result));
    Check(napi_create_array_with_length(env, document.pageCount, &images));
    Check(napi_create_uint32(env, (uint32_t)document.pageCount, &pageCount));
    Check(napi_set_named_property(env, result, "pageCount", pageCount));
    NSMutableString *text = [NSMutableString string];
    size_t imageBytes = 0;
    for (NSUInteger index = 0; index < document.pageCount; ++index) {
      PDFPage *page = [document pageAtIndex:index];
      [text appendFormat:@"\n--- Page %lu ---\n%@\n", (unsigned long)(index + 1), page.string ?: @""];
      if (text.length > 100000) throw std::runtime_error("The PDF text is too large for one request");
      NSImage *thumbnail = [page thumbnailOfSize:NSMakeSize(1400, 1800) forBox:kPDFDisplayBoxMediaBox];
      NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithData:thumbnail.TIFFRepresentation];
      NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
      if (!png.length) throw std::runtime_error("Cannot render a PDF page");
      imageBytes += png.length;
      if (imageBytes > 32 * 1024 * 1024) throw std::runtime_error("The PDF pages are too large to attach");
      napi_value image;
      Check(napi_create_buffer_copy(env, png.length, png.bytes, nullptr, &image));
      Check(napi_set_element(env, images, index, image));
    }
    napi_value textValue;
    const char *utf8 = text.UTF8String;
    Check(napi_create_string_utf8(env, utf8, NAPI_AUTO_LENGTH, &textValue));
    Check(napi_set_named_property(env, result, "text", textValue));
    Check(napi_set_named_property(env, result, "images", images));
    return result;
  } catch (const std::exception &error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

void RegisterAssistantPDF(napi_env env, napi_value exports) {
  napi_value function;
  Check(napi_create_function(env, "extractAssistantPDF", NAPI_AUTO_LENGTH, ExtractAssistantPDF, nullptr, &function));
  Check(napi_set_named_property(env, exports, "extractAssistantPDF", function));
}
