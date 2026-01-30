// SmithersKit embedding API
// This is a proxy layer over GhosttyKit for future AI features.
// Currently it passes all calls through to GhosttyKit.

#ifndef SMITHERS_H
#define SMITHERS_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

// We re-export all GhosttyKit types since SmithersKit is a thin wrapper.
// In the future, we may define our own types for AI-specific features.
#include "ghostty.h"

//-------------------------------------------------------------------
// Macros

#define SMITHERS_SUCCESS 0

//-------------------------------------------------------------------
// SmithersKit API (mirrors GhosttyKit with smithers_ prefix)

// Initialization
int smithers_init(uintptr_t, char**);
void smithers_cli_try_action(void);
ghostty_info_s smithers_info(void);
const char* smithers_translate(const char*);
void smithers_string_free(ghostty_string_s);

// Configuration
ghostty_config_t smithers_config_new(void);
void smithers_config_free(ghostty_config_t);
ghostty_config_t smithers_config_clone(ghostty_config_t);
void smithers_config_load_cli_args(ghostty_config_t);
void smithers_config_load_file(ghostty_config_t, const char*);
void smithers_config_load_default_files(ghostty_config_t);
void smithers_config_load_recursive_files(ghostty_config_t);
void smithers_config_finalize(ghostty_config_t);
bool smithers_config_get(ghostty_config_t, void*, const char*, uintptr_t);
ghostty_input_trigger_s smithers_config_trigger(ghostty_config_t,
                                                const char*,
                                                uintptr_t);
uint32_t smithers_config_diagnostics_count(ghostty_config_t);
ghostty_diagnostic_s smithers_config_get_diagnostic(ghostty_config_t, uint32_t);
ghostty_string_s smithers_config_open_path(void);

// Application
ghostty_app_t smithers_app_new(const ghostty_runtime_config_s*,
                               ghostty_config_t);
void smithers_app_free(ghostty_app_t);
void smithers_app_tick(ghostty_app_t);
void* smithers_app_userdata(ghostty_app_t);
void smithers_app_set_focus(ghostty_app_t, bool);
bool smithers_app_key(ghostty_app_t, ghostty_input_key_s);
bool smithers_app_key_is_binding(ghostty_app_t, ghostty_input_key_s);
void smithers_app_keyboard_changed(ghostty_app_t);
void smithers_app_open_config(ghostty_app_t);
void smithers_app_update_config(ghostty_app_t, ghostty_config_t);
bool smithers_app_needs_confirm_quit(ghostty_app_t);
bool smithers_app_has_global_keybinds(ghostty_app_t);
void smithers_app_set_color_scheme(ghostty_app_t, ghostty_color_scheme_e);

// Surface Configuration
ghostty_surface_config_s smithers_surface_config_new(void);

// Surface
ghostty_surface_t smithers_surface_new(ghostty_app_t,
                                       const ghostty_surface_config_s*);
void smithers_surface_free(ghostty_surface_t);
void* smithers_surface_userdata(ghostty_surface_t);
ghostty_app_t smithers_surface_app(ghostty_surface_t);
ghostty_surface_config_s smithers_surface_inherited_config(ghostty_surface_t,
                                                           ghostty_surface_context_e);
void smithers_surface_update_config(ghostty_surface_t, ghostty_config_t);
bool smithers_surface_needs_confirm_quit(ghostty_surface_t);
bool smithers_surface_process_exited(ghostty_surface_t);
void smithers_surface_refresh(ghostty_surface_t);
void smithers_surface_draw(ghostty_surface_t);
void smithers_surface_set_content_scale(ghostty_surface_t, double, double);
void smithers_surface_set_focus(ghostty_surface_t, bool);
void smithers_surface_set_occlusion(ghostty_surface_t, bool);
void smithers_surface_set_size(ghostty_surface_t, uint32_t, uint32_t);
ghostty_surface_size_s smithers_surface_size(ghostty_surface_t);
void smithers_surface_set_color_scheme(ghostty_surface_t,
                                       ghostty_color_scheme_e);
ghostty_input_mods_e smithers_surface_key_translation_mods(ghostty_surface_t,
                                                           ghostty_input_mods_e);
bool smithers_surface_key(ghostty_surface_t, ghostty_input_key_s);
bool smithers_surface_key_is_binding(ghostty_surface_t,
                                     ghostty_input_key_s,
                                     ghostty_binding_flags_e*);
void smithers_surface_text(ghostty_surface_t, const char*, uintptr_t);
void smithers_surface_preedit(ghostty_surface_t, const char*, uintptr_t);
bool smithers_surface_mouse_captured(ghostty_surface_t);
bool smithers_surface_mouse_button(ghostty_surface_t,
                                   ghostty_input_mouse_state_e,
                                   ghostty_input_mouse_button_e,
                                   ghostty_input_mods_e);
void smithers_surface_mouse_pos(ghostty_surface_t,
                                double,
                                double,
                                ghostty_input_mods_e);
void smithers_surface_mouse_scroll(ghostty_surface_t,
                                   double,
                                   double,
                                   ghostty_input_scroll_mods_t);
void smithers_surface_mouse_pressure(ghostty_surface_t, uint32_t, double);
void smithers_surface_ime_point(ghostty_surface_t, double*, double*, double*, double*);
void smithers_surface_request_close(ghostty_surface_t);
void smithers_surface_split(ghostty_surface_t, ghostty_action_split_direction_e);
void smithers_surface_split_focus(ghostty_surface_t,
                                  ghostty_action_goto_split_e);
void smithers_surface_split_resize(ghostty_surface_t,
                                   ghostty_action_resize_split_direction_e,
                                   uint16_t);
void smithers_surface_split_equalize(ghostty_surface_t);
bool smithers_surface_binding_action(ghostty_surface_t, const char*, uintptr_t);
void smithers_surface_complete_clipboard_request(ghostty_surface_t,
                                                 const char*,
                                                 void*,
                                                 bool);
bool smithers_surface_has_selection(ghostty_surface_t);
bool smithers_surface_read_selection(ghostty_surface_t, ghostty_text_s*);
bool smithers_surface_read_text(ghostty_surface_t,
                                ghostty_selection_s,
                                ghostty_text_s*);
void smithers_surface_free_text(ghostty_surface_t, ghostty_text_s*);

#ifdef __APPLE__
void smithers_surface_set_display_id(ghostty_surface_t, uint32_t);
void* smithers_surface_quicklook_font(ghostty_surface_t);
bool smithers_surface_quicklook_word(ghostty_surface_t, ghostty_text_s*);
#endif

// Inspector
ghostty_inspector_t smithers_surface_inspector(ghostty_surface_t);
void smithers_inspector_free(ghostty_surface_t);
void smithers_inspector_set_focus(ghostty_inspector_t, bool);
void smithers_inspector_set_content_scale(ghostty_inspector_t, double, double);
void smithers_inspector_set_size(ghostty_inspector_t, uint32_t, uint32_t);
void smithers_inspector_mouse_button(ghostty_inspector_t,
                                     ghostty_input_mouse_state_e,
                                     ghostty_input_mouse_button_e,
                                     ghostty_input_mods_e);
void smithers_inspector_mouse_pos(ghostty_inspector_t, double, double);
void smithers_inspector_mouse_scroll(ghostty_inspector_t,
                                     double,
                                     double,
                                     ghostty_input_scroll_mods_t);
void smithers_inspector_key(ghostty_inspector_t,
                            ghostty_input_action_e,
                            ghostty_input_key_e,
                            ghostty_input_mods_e);
void smithers_inspector_text(ghostty_inspector_t, const char*);

#ifdef __APPLE__
bool smithers_inspector_metal_init(ghostty_inspector_t, void*);
void smithers_inspector_metal_render(ghostty_inspector_t, void*, void*);
bool smithers_inspector_metal_shutdown(ghostty_inspector_t);
#endif

// Misc APIs
void smithers_set_window_background_blur(ghostty_app_t, void*);
bool smithers_benchmark_cli(const char*, const char*);

// SmithersKit-specific APIs (for future AI features)
const char* smithers_version(void);

#ifdef __cplusplus
}
#endif

#endif /* SMITHERS_H */
