// global ide object
import $ from "jquery";
import _ from "lodash";
import jQuery from "jquery";
import "jquery-ui/ui/widgets/autocomplete";
import "jquery-ui/ui/widgets/resizable";
import "jquery-ui/ui/widgets/tooltip";
import "jquery-ui/ui/widgets/button";
import html2canvas from "html2canvas";
import rgbcolor from "canvg/rgbcolor";
import canvg from "canvg";
import "./promise-polyfill";
import L from "leaflet";
import CodeMirror from "codemirror/lib/codemirror.js";
import moment from "moment";
import tokml from "tokml";
import togpx from "togpx";
import {saveAs} from "file-saver";
import "canvas-toBlob"; // polyfill
import configs from "./configs";
import Query from "./query";
import Nominatim from "./nominatim";
import ffs from "./ffs";
import i18n from "./i18n";
import settings from "./settings";
import overpass from "./overpass";
import urlParameters from "./urlParameters";
import Autorepair from "./autorepair";
import {Base64, htmlentities, lzw_encode, lzw_decode} from "./misc";
import sync from "./sync-with-osm";
import shortcuts from "./shortcuts";

// Handler to allow copying in various MIME formats
// @see https://developer.mozilla.org/en-US/docs/Web/Events/copy
// @see https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData
var copyData = undefined;
$(document).on("copy", function(e) {
  if (copyData && e.originalEvent && e.originalEvent.clipboardData) {
    Object.keys(copyData).forEach(function(format) {
      e.originalEvent.clipboardData.setData(format, copyData[format]);
    });
    e.originalEvent.preventDefault();
    copyData = undefined;
  } else if (copyData && copyData["text/plain"]) {
    prompt(i18n.t("export.copy_to_clipboard"), copyData["text/plain"]);
    copyData = null;
  }
});

var ide = new (function() {
  // == private members ==
  var attribControl = null;
  var scaleControl = null;
  var queryParser = Query();
  var nominatim = Nominatim();
  // == public members ==
  this.codeEditor = null;
  this.dataViewer = null;
  this.map = null;
  var ide = this;

  // == helpers ==

  var make_combobox = function(input, options, deletables, deleteCallback) {
    if (input[0].is_combobox) {
      input.autocomplete("option", {source: options});
      return;
    }
    var wrapper = input
      .wrap("<span>")
      .parent()
      .addClass("ui-combobox");
    input
      .autocomplete({
        source: options,
        minLength: 0
      })
      .addClass("ui-widget ui-widget-content ui-corner-left ui-state-default")
      .autocomplete("instance")._renderItem = function(ul, item) {
      return $("<li>")
        .append(
          deletables && deletables.indexOf(item.value) !== -1
            ? '<div title="shift-click to remove from list" style="font-style:italic;">' +
                item.label +
                "</div>"
            : "<div>" + item.label + "</div>"
        )
        .on("click", function(event) {
          if (event.shiftKey && deletables.indexOf(item.value) !== -1) {
            deleteCallback(item.value);
            $(this).remove();
            var options = input.autocomplete("option", "source");
            options.splice(options.indexOf(item), 1);
            input.autocomplete("option", "source", options);
            return false;
          }
        })
        .appendTo(ul);
    };
    $("<a>")
      .attr("tabIndex", -1)
      .attr("title", "show all items")
      .appendTo(wrapper)
      .button({
        icons: {primary: "ui-icon-triangle-1-s"},
        text: false
      })
      .removeClass("ui-corner-all")
      .addClass("ui-corner-right ui-combobox-toggle")
      .click(function() {
        // close if already visible
        if (input.autocomplete("widget").is(":visible")) {
          input.autocomplete("close");
          return;
        }
        // pass empty string as value to search for, displaying all results
        input.autocomplete("search", "");
        input.focus();
      });
    input[0].is_combobox = true;
  }; // make_combobox()

  var showDialog = function(title, content, buttons) {
    var dialogContent =
      '\
      <div class="modal is-active">\
        <div class="modal-background"></div>\
        <div class="modal-card">\
          <header class="modal-card-head">\
            <p class="modal-card-title">' +
      title +
      '</p>\
            <button class="delete" aria-label="close"></button>\
          </header>\
          <section class="modal-card-body">\
            ' +
      content +
      '\
          </section>\
          <footer class="modal-card-foot">\
            <div class="level">\
              <div class="level-right">\
                <div class="level-item">\
                </div>\
              </div>\
            </div>\
          </footer>\
        </div>\
      </div>\
    ';

    // Create modal in body
    var element = $(dialogContent);
    // Handle close event
    $(".delete", element).click(function() {
      $(element).remove();
    });

    // Add all the buttons
    for (var index in buttons) {
      var button = buttons[index];
      $('<button class="button">' + button.name + "</button>")
        .click(
          (function(callback) {
            return function() {
              $(element).remove();
              if (callback) {
                callback();
              }
            };
          })(button.callback)
        )
        .appendTo($("footer .level-item", element));
    }

    // Add the element to the body
    element.appendTo("body");
  };

  // == public sub objects ==

  this.waiter = {
    opened: true,
    frames: ["◴", "◷", "◶", "◵"],
    frameDelay: 250,
    open: function(show_info) {
      if (show_info) {
        $(".modal .wait-info h4").text(show_info);
        $(".wait-info").show();
      } else {
        $(".wait-info").hide();
      }
      $("#loading-dialog").addClass("is-active");
      document.title = ide.waiter.frames[0] + " " + ide.waiter._initialTitle;
      var f = 0;
      ide.waiter.interval = setInterval(
        function() {
          document.title =
            (this.isAlert
              ? this.alertFrame
              : this.frames[++f % this.frames.length]) +
            " " +
            this._initialTitle;
        }.bind(ide.waiter),
        ide.waiter.frameDelay
      );
      ide.waiter.opened = true;
    },
    close: function() {
      if (!ide.waiter.opened) return;
      clearInterval(ide.waiter.interval);
      document.title = ide.waiter._initialTitle;
      $("#loading-dialog").removeClass("is-active");
      $(".wait-info ul li").remove();
      delete ide.waiter.onAbort;
      ide.waiter.opened = false;
    },
    addInfo: function(txt, abortCallback) {
      $("#aborter").remove(); // remove previously added abort button, which cannot be used anymore.
      $(".wait-info ul li:nth-child(n+1)").css("opacity", 0.5);
      $(".wait-info ul li span.fas")
        .removeClass("fa-spinner")
        .removeClass("fa-spin")
        .addClass("fa-check");
      $(".wait-info ul li:nth-child(n+4)").hide();
      var li = $(
        '<li><span class="fas fa-spinner fa-spin" style="display:inline-block; margin-bottom:-2px; margin-right:3px;"></span>' +
          txt +
          "</li>"
      );
      if (typeof abortCallback == "function") {
        ide.waiter.onAbort = abortCallback;
        var aborter = $(
          '<span id="aborter">&nbsp;(<a href="#">abort</a>)</span>'
        ).on("click", function() {
          ide.waiter.abort();
          return false;
        });
        li.append(aborter);
      }
      $(".wait-info ul").prepend(li);
    },
    abort: function() {
      if (typeof ide.waiter.onAbort == "function") {
        ide.waiter.addInfo("aborting");
        ide.waiter.onAbort(ide.waiter.close);
      }
    }
  };
  this.waiter._initialTitle = document.title;

  // == public methods ==

  this.init = function() {
    ide.waiter.addInfo("ide starting up");
    $("#overpass-turbo-version").html(
      "overpass-turbo <code>" + GIT_VERSION + "</code>" // eslint-disable-line no-undef
    );
    // (very raw) compatibility check <- TODO: put this into its own function
    if (
      jQuery.support.cors != true ||
      //typeof localStorage  != "object" ||
      typeof (function() {
        var ls = undefined;
        try {
          localStorage.setItem("startup_localstorage_quota_test", 123);
          localStorage.removeItem("startup_localstorage_quota_test");
          ls = localStorage;
        } catch (e) {}
        return ls;
      })() != "object" ||
      false
    ) {
      // the currently used browser is not capable of running the IDE. :(
      ide.not_supported = true;
      $("#warning-unsupported-browser").addClass("is-active");
    }
    // load settings
    ide.waiter.addInfo("load settings");
    settings.load();
    // translate ui
    ide.waiter.addInfo("translate ui");
    var me = this;
    i18n.translate().then(function() {
      initAfterI18n.call(me);
    });

    if (sync.enabled) {
      $("#load-dialog .osm").show();
      if (sync.authenticated()) $("#logout").show();
    }
  };

  function initAfterI18n() {
    // set up additional libraries
    moment.locale(i18n.getLanguage());
    // parse url string parameters
    ide.waiter.addInfo("parse url parameters");
    var args = urlParameters(location.search);
    // set appropriate settings
    if (args.has_coords) {
      // map center coords set via url
      settings.coords_lat = args.coords.lat;
      settings.coords_lon = args.coords.lng;
    }
    if (args.has_zoom) {
      // map zoom set via url
      settings.coords_zoom = args.zoom;
    }
    if (args.run_query) {
      // query autorun activated via url
      ide.run_query_on_startup = true;
    }
    settings.save();
    if (typeof history.replaceState == "function")
      history.replaceState({}, "", "."); // drop startup parameters

    ide.waiter.addInfo("initialize page");
    // init page layout
    var isInitialAspectPortrait = $(window).width() / $(window).height() < 0.8;
    if (settings.editor_width != "" && !isInitialAspectPortrait) {
      $("#editor").css("width", settings.editor_width);
      $("#dataviewer").css("left", settings.editor_width);
    }
    if (isInitialAspectPortrait) {
      $("#editor, #dataviewer").addClass("portrait");
    }
    // make panels resizable
    $("#editor").resizable({
      handles: isInitialAspectPortrait ? "s" : "e",
      minWidth: isInitialAspectPortrait ? undefined : "200",
      resize: function(ev) {
        if (!isInitialAspectPortrait) {
          $(this)
            .next()
            .css("left", $(this).outerWidth() + "px");
        } else {
          var top = $(this).offset().top + $(this).outerHeight();
          $(this)
            .next()
            .css("top", top + "px");
        }
        ide.map.invalidateSize(false);
      },
      stop: function() {
        if (isInitialAspectPortrait) return;
        settings.editor_width = $("#editor").css("width");
        settings.save();
      }
    });
    $("#editor").prepend(
      "<span class='ui-resizable-handle ui-resizable-se ui-icon ui-icon-gripsmall-diagonal-se'/>"
    );

    // init codemirror
    $("#editor textarea")[0].value = settings.code["overpass"];
    if (settings.use_rich_editor) {
      var pending = 0;
      CodeMirror.defineMIME("text/x-overpassQL", {
        name: "clike",
        keywords: (function(str) {
          var r = {};
          var a = str.split(" ");
          for (var i = 0; i < a.length; i++) r[a[i]] = true;
          return r;
        })(
          "out json xml custom popup timeout maxsize bbox" + // initial declarations
          " date diff adiff" + //attic declarations
          " foreach" + // block statements
          " relation rel way node is_in area around user uid newer changed poly pivot nwr derived" + // queries
          " out meta body skel tags ids count qt asc" + // actions
            " center bb geom" // geometry types
          //+"r w n br bw" // recursors
        )
      });
      CodeMirror.defineMIME("text/x-overpassXML", "xml");
      CodeMirror.defineMode("xml+mustache", function(config) {
        return CodeMirror.multiplexingMode(
          CodeMirror.multiplexingMode(CodeMirror.getMode(config, "xml"), {
            open: "{{",
            close: "}}",
            mode: CodeMirror.getMode(config, "text/plain"),
            delimStyle: "mustache"
          }),
          {
            open: "{{style:",
            close: "}}",
            mode: CodeMirror.getMode(config, "text/css"),
            delimStyle: "mustache"
          }
        );
      });
      CodeMirror.defineMode("ql+mustache", function(config) {
        return CodeMirror.multiplexingMode(
          CodeMirror.multiplexingMode(
            CodeMirror.getMode(config, "text/x-overpassQL"),
            {
              open: "{{",
              close: "}}",
              mode: CodeMirror.getMode(config, "text/plain"),
              delimStyle: "mustache"
            }
          ),
          {
            open: "{{style:",
            close: "}}",
            mode: CodeMirror.getMode(config, "text/css"),
            delimStyle: "mustache"
          }
        );
      });
      ide.codeEditor = CodeMirror.fromTextArea($("#editor textarea")[0], {
        //value: settings.code["overpass"],
        lineNumbers: true,
        lineWrapping: true,
        mode: "text/plain",
        onChange: function(e) {
          clearTimeout(pending);
          pending = setTimeout(function() {
            // update syntax highlighting mode
            if (ide.getQueryLang() == "xml") {
              if (e.getOption("mode") != "xml+mustache") {
                e.closeTagEnabled = true;
                e.setOption("matchBrackets", false);
                e.setOption("mode", "xml+mustache");
              }
            } else {
              if (e.getOption("mode") != "ql+mustache") {
                e.closeTagEnabled = false;
                e.setOption("matchBrackets", true);
                e.setOption("mode", "ql+mustache");
              }
            }
            // check for inactive ui elements
            var bbox_filter = $(".leaflet-control-buttons-bboxfilter");
            if (ide.getRawQuery().match(/\{\{bbox\}\}/)) {
              if (bbox_filter.hasClass("disabled")) {
                bbox_filter.removeClass("disabled");
                bbox_filter.attr("data-t", "[title]map_controlls.select_bbox");
                i18n.translate_ui(bbox_filter[0]);
              }
            } else {
              if (!bbox_filter.hasClass("disabled")) {
                bbox_filter.addClass("disabled");
                bbox_filter.attr(
                  "data-t",
                  "[title]map_controlls.select_bbox_disabled"
                );
                i18n.translate_ui(bbox_filter[0]);
              }
            }
          }, 500);
          settings.code["overpass"] = e.getValue();
          settings.save();
        },
        closeTagEnabled: true,
        closeTagIndent: [
          "osm-script",
          "query",
          "union",
          "foreach",
          "difference"
        ],
        extraKeys: {
          "'>'": function(cm) {
            cm.closeTag(cm, ">");
          },
          "'/'": function(cm) {
            cm.closeTag(cm, "/");
          }
        }
      });
      // fire onChange after initialization
      ide.codeEditor.getOption("onChange")(ide.codeEditor);
    } else {
      // use non-rich editor
      ide.codeEditor = $("#editor textarea")[0];
      ide.codeEditor.getValue = function() {
        return this.value;
      };
      ide.codeEditor.setValue = function(v) {
        this.value = v;
      };
      ide.codeEditor.lineCount = function() {
        return this.value.split(/\r\n|\r|\n/).length;
      };
      ide.codeEditor.setLineClass = function() {};
      $("#editor textarea").bind("input change", function(e) {
        settings.code["overpass"] = e.target.getValue();
        settings.save();
      });
    }
    // set query if provided as url parameter or template:
    if (args.has_query) {
      // query set via url
      ide.codeEditor.setValue(args.query);
    }
    // init dataviewer
    ide.dataViewer = CodeMirror($("#data")[0], {
      value: "no data loaded yet",
      lineNumbers: true,
      readOnly: true,
      mode: "javascript"
    });

    // init leaflet
    ide.map = new L.Map("map", {
      attributionControl: false,
      minZoom: 0,
      maxZoom: configs.maxMapZoom,
      worldCopyJump: false
    });
    var tilesUrl = settings.tile_server;
    var tilesAttrib = configs.tileServerAttribution;
    var tiles = new L.TileLayer(tilesUrl, {
      attribution: tilesAttrib,
      noWrap: true,
      maxNativeZoom: 19,
      maxZoom: ide.map.options.maxZoom
    });
    attribControl = new L.Control.Attribution({prefix: ""});
    attribControl.addAttribution(tilesAttrib);
    var pos = new L.LatLng(settings.coords_lat, settings.coords_lon);
    ide.map.setView(pos, settings.coords_zoom).addLayer(tiles);
    ide.map.tile_layer = tiles;
    // inverse opacity layer
    ide.map.inv_opacity_layer = L.tileLayer(
      "data:image/gif;base64,R0lGODlhAQABAIAAAP7//wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=="
    ).setOpacity(1 - settings.background_opacity);
    if (settings.background_opacity != 1)
      ide.map.inv_opacity_layer.addTo(ide.map);
    scaleControl = new L.Control.Scale({metric: true, imperial: false});
    scaleControl.addTo(ide.map);
    ide.map.on("moveend", function() {
      settings.coords_lat = ide.map.getCenter().lat;
      settings.coords_lon = ide.map.getCenter().lng;
      settings.coords_zoom = ide.map.getZoom();
      settings.save(); // save settings
    });

    // tabs
    $("#dataviewer > div#data")[0].style.zIndex = -1001;
    $(".tabs li").bind("click", function(e) {
      if ($(e.target).hasClass("is-active")) {
        return;
      } else {
        $("#dataviewer > div#data")[0].style.zIndex =
          -1 * $("#dataviewer > div#data")[0].style.zIndex;
        $(".tabs li").toggleClass("is-active");
      }
    });

    // keyboard event listener
    $(document).keydown(ide.onKeyPress);

    // leaflet extension: more map controls
    var MapButtons = L.Control.extend({
      options: {
        position: "topleft"
      },
      onAdd: function(map) {
        // create the control container with a particular class name
        var container = L.DomUtil.create(
          "div",
          "leaflet-control-buttons leaflet-bar"
        );
        var link = L.DomUtil.create(
          "a",
          "leaflet-control-buttons-fitdata leaflet-bar-part leaflet-bar-part-top",
          container
        );
        $('<span class="fas fa-search"/>').appendTo($(link));
        link.href = "#";
        link.className += " t";
        link.setAttribute("data-t", "[title]map_controlls.zoom_to_data");
        i18n.translate_ui(link);
        L.DomEvent.addListener(
          link,
          "click",
          function() {
            // hardcoded maxZoom of 18, should be ok for most real-world use-cases
            try {
              ide.map.fitBounds(overpass.osmLayer.getBaseLayer().getBounds(), {
                maxZoom: 18
              });
            } catch (e) {}
            return false;
          },
          ide.map
        );
        link = L.DomUtil.create(
          "a",
          "leaflet-control-buttons-myloc leaflet-bar-part",
          container
        );
        $('<span class="fas fa-crosshairs"/>').appendTo($(link));
        link.href = "#";
        link.className += " t";
        link.setAttribute("data-t", "[title]map_controlls.localize_user");
        if (!window.isSecureContext) {
          link.className += " disabled";
          link.setAttribute(
            "data-t",
            "[title]map_controlls.localize_user_disabled"
          );
        }
        i18n.translate_ui(link);
        L.DomEvent.addListener(
          link,
          "click",
          function() {
            // One-shot position request.
            try {
              navigator.geolocation.getCurrentPosition(function(position) {
                var pos = new L.LatLng(
                  position.coords.latitude,
                  position.coords.longitude
                );
                ide.map.setView(pos, settings.coords_zoom);
              });
            } catch (e) {}
            return false;
          },
          ide.map
        );
        link = L.DomUtil.create(
          "a",
          "leaflet-control-buttons-bboxfilter leaflet-bar-part",
          container
        );
        $('<span class="fas fa-image"/>').appendTo($(link));
        link.href = "#";
        link.className += " t";
        link.setAttribute("data-t", "[title]map_controlls.select_bbox");
        i18n.translate_ui(link);
        L.DomEvent.addListener(
          link,
          "click",
          function(e) {
            if (
              $(e.target)
                .parent()
                .hasClass("disabled") // check if this button is enabled
            )
              return false;
            if (!ide.map.bboxfilter.isEnabled()) {
              ide.map.bboxfilter.setBounds(ide.map.getBounds().pad(-0.2));
              ide.map.bboxfilter.enable();
            } else {
              ide.map.bboxfilter.disable();
            }
            $(e.target)
              .toggleClass("fa-times-circle")
              .toggleClass("fa-image");
            return false;
          },
          ide.map
        );
        link = L.DomUtil.create(
          "a",
          "leaflet-control-buttons-fullscreen leaflet-bar-part",
          container
        );
        $('<span class="fas fa-step-backward"/>').appendTo($(link));
        link.href = "#";
        link.className += " t";
        link.setAttribute("data-t", "[title]map_controlls.toggle_wide_map");
        i18n.translate_ui(link);
        L.DomEvent.addListener(
          link,
          "click",
          function(e) {
            $("#dataviewer").toggleClass("fullscreen");
            ide.map.invalidateSize();
            $(e.target)
              .toggleClass("fa-step-forward")
              .toggleClass("fa-step-backward");
            $("#editor").toggleClass("hidden");
            if ($("#editor").resizable("option", "disabled"))
              $("#editor").resizable("enable");
            else $("#editor").resizable("disable");
            return false;
          },
          ide.map
        );
        link = L.DomUtil.create(
          "a",
          "leaflet-control-buttons-clearoverlay leaflet-bar-part leaflet-bar-part-bottom",
          container
        );
        $('<span class="fas fa-ban"/>').appendTo($(link));
        link.href = "#";
        link.className += " t";
        link.setAttribute("data-t", "[title]map_controlls.toggle_data");
        i18n.translate_ui(link);
        L.DomEvent.addListener(
          link,
          "click",
          function(e) {
            e.preventDefault();
            if (ide.map.hasLayer(overpass.osmLayer))
              ide.map.removeLayer(overpass.osmLayer);
            else ide.map.addLayer(overpass.osmLayer);
            return false;
          },
          ide.map
        );
        return container;
      }
    });
    ide.map.addControl(new MapButtons());
    // prevent propagation of doubleclicks on map controls
    $(".leaflet-control-buttons > a").bind("dblclick", function(e) {
      e.stopPropagation();
    });
    // add tooltips to map controls
    $(".leaflet-control-buttons > a").tooltip({
      items: "a[title]",
      hide: {
        effect: "fadeOut",
        duration: 100
      },
      position: {
        my: "left+5 center",
        at: "right center"
      }
    });
    // leaflet extension: search box
    var SearchBox = L.Control.extend({
      options: {
        position: "topright"
      },
      onAdd: function(map) {
        var container = L.DomUtil.create(
          "div",
          "leaflet-control-search control has-icons-left"
        );
        container.style.position = "absolute";
        container.style.right = "0";
        var inp = L.DomUtil.create("input", "input is-rounded", container);
        $('<span class="icon is-left"><span class="fas fa-search"/></span>')
          .click(function(e) {
            $(this)
              .prev()
              .autocomplete("search");
          })
          .insertAfter(inp);
        inp.id = "search";
        inp.type = "search";
        // hack against focus stealing leaflet :/
        inp.onclick = function() {
          this.focus();
        };
        // prevent propagation of doubleclicks to map container
        container.ondblclick = function(e) {
          e.stopPropagation();
        };
        // autocomplete functionality
        $(inp).autocomplete({
          source: function(request, response) {
            // ajax (GET) request to nominatim
            $.ajax(
              "https://search.osmnames.org/q/" +
                encodeURIComponent(request.term) +
                ".js?key=" +
                configs.osmnamesApiKey,
              {
                success: function(data) {
                  // hacky firefox hack :( (it is not properly detecting json from the content-type header)
                  if (typeof data == "string") {
                    // if the data is a string, but looks more like a json object
                    try {
                      data = $.parseJSON(data);
                    } catch (e) {}
                  }
                  response(
                    $.map(data.results.slice(0, 10), function(item) {
                      return {
                        label: item.display_name,
                        value: item.display_name,
                        lat: item.lat,
                        lon: item.lon,
                        boundingbox: item.boundingbox
                      };
                    })
                  );
                },
                error: function() {
                  // todo: better error handling
                  console.error(
                    "An error occured while contacting the search server osmnames.org :("
                  );
                }
              }
            );
          },
          minLength: 2,
          autoFocus: true,
          select: function(event, ui) {
            if (ui.item.boundingbox && ui.item.boundingbox instanceof Array)
              ide.map.fitBounds(
                L.latLngBounds([
                  [ui.item.boundingbox[1], ui.item.boundingbox[0]],
                  [ui.item.boundingbox[3], ui.item.boundingbox[2]]
                ]),
                {maxZoom: 18}
              );
            else ide.map.panTo(new L.LatLng(ui.item.lat, ui.item.lon));
            this.value = "";
            return false;
          },
          open: function() {
            $(this)
              .removeClass("ui-corner-all")
              .addClass("ui-corner-top");
          },
          close: function() {
            $(this)
              .addClass("ui-corner-all")
              .removeClass("ui-corner-top");
          }
        });
        $(inp).autocomplete("option", "delay", 20);
        //$(inp).autocomplete().keypress(function(e) {if (e.which==13 || e.which==10) $(this).autocomplete("search");});
        return container;
      }
    });
    ide.map.addControl(new SearchBox());
    // add cross hairs to map
    $('<span class="fas fa-plus" />')
      .addClass("crosshairs")
      .hide()
      .appendTo("#map");
    if (settings.enable_crosshairs) $(".crosshairs").show();

    ide.map.bboxfilter = new L.LocationFilter({
      enable: !true,
      adjustButton: false,
      enableButton: false
    }).addTo(ide.map);

    ide.map.on("popupopen popupclose", function(e) {
      if (typeof e.popup.layer != "undefined") {
        var layer = e.popup.layer.placeholder || e.popup.layer;
        // re-call style handler to eventually modify the style of the clicked feature
        var stl = overpass.osmLayer._baseLayer.options.style(
          layer.feature,
          e.type == "popupopen"
        );
        if (typeof layer.eachLayer != "function") {
          if (typeof layer.setStyle == "function") layer.setStyle(stl); // other objects (pois, ways)
        } else
          layer.eachLayer(function(layer) {
            if (typeof layer.setStyle == "function") layer.setStyle(stl);
          }); // for multipolygons!
      }
    });

    // init overpass object
    overpass.init();

    // event handlers for overpass object
    overpass.handlers["onProgress"] = function(msg, abortcallback) {
      ide.waiter.addInfo(msg, abortcallback);
    };
    overpass.handlers["onDone"] = function() {
      ide.waiter.close();
      var map_bounds = ide.map.getBounds();
      var data_bounds = overpass.osmLayer.getBaseLayer().getBounds();
      if (data_bounds.isValid() && !map_bounds.intersects(data_bounds)) {
        // show tooltip for button "zoom to data"
        var prev_content = $(".leaflet-control-buttons-fitdata").tooltip(
          "option",
          "content"
        );
        $(".leaflet-control-buttons-fitdata").tooltip(
          "option",
          "content",
          "← " + i18n.t("map_controlls.suggest_zoom_to_data")
        );
        $(".leaflet-control-buttons-fitdata").tooltip("open");
        $(".leaflet-control-buttons-fitdata").tooltip("option", "hide", {
          effect: "fadeOut",
          duration: 1000
        });
        setTimeout(function() {
          $(".leaflet-control-buttons-fitdata").tooltip(
            "option",
            "content",
            prev_content
          );
          $(".leaflet-control-buttons-fitdata").tooltip("close");
          $(".leaflet-control-buttons-fitdata").tooltip("option", "hide", {
            effect: "fadeOut",
            duration: 100
          });
        }, 2600);
      }
    };
    overpass.handlers["onEmptyMap"] = function(empty_msg, data_mode) {
      // show warning/info if only invisible data is returned
      if (empty_msg == "no visible data") {
        if (!settings.no_autorepair) {
          var content =
            "<p>" +
            i18n.t("warning.incomplete.expl.1") +
            "</p><p>" +
            i18n.t("warning.incomplete.expl.2") +
            '</p><p><input type="checkbox" name="hide_incomplete_data_warning"/>&nbsp;' +
            i18n.t("warning.incomplete.not_again") +
            "</p>";

          var dialog_buttons = [
            {
              name: i18n.t("dialog.repair_query"),
              callback: function() {
                ide.repairQuery("no visible data");
              }
            },
            {
              name: i18n.t("dialog.show_data"),
              callback: function() {
                if (
                  $("input[name=hide_incomplete_data_warning]", this)[0].checked
                ) {
                  settings.no_autorepair = true;
                  settings.save();
                }
                ide.switchTab("Data");
              }
            }
          ];
          showDialog(
            i18n.t("warning.incomplete.title"),
            content,
            dialog_buttons
          );
        }
      }
      // auto tab switching (if only areas are returned)
      if (empty_msg == "only areas returned") ide.switchTab("Data");
      // auto tab switching (if nodes without coordinates are returned)
      if (empty_msg == "no coordinates returned") ide.switchTab("Data");
      // auto tab switching (if unstructured data is returned)
      if (data_mode == "unknown") ide.switchTab("Data");
      // display empty map badge
      $(
        '<div id="map_blank" style="z-index:5; display:block; position:relative; top:42px; width:100%; text-align:center; background-color:#eee; opacity: 0.8;">' +
          i18n.t("map.intentionally_blank") +
          " <small>(" +
          empty_msg +
          ")</small></div>"
      ).appendTo("#map");
    };
    overpass.handlers["onDataRecieved"] = function(
      amount,
      amount_txt,
      abortCB,
      continueCB
    ) {
      if (amount > 1000000) {
        ide.waiter.close();
        var _originalDocumentTitle = document.title;
        document.title = "❗ " + _originalDocumentTitle;
        // more than ~1MB of data
        // show warning dialog
        var dialog_buttons = [
          {
            name: i18n.t("dialog.abort"),
            callback: function() {
              document.title = _originalDocumentTitle;
              abortCB();
            }
          },
          {
            name: i18n.t("dialog.continue_anyway"),
            callback: function() {
              document.title = _originalDocumentTitle;
              continueCB();
            }
          }
        ];

        var content =
          "<p>" +
          i18n
            .t("warning.huge_data.expl.1")
            .replace("{{amount_txt}}", amount_txt) +
          "</p><p>" +
          i18n.t("warning.huge_data.expl.2") +
          "</p>";
        showDialog(i18n.t("warning.huge_data.title"), content, dialog_buttons);
      } else continueCB();
    };
    overpass.handlers["onAbort"] = function() {
      ide.waiter.close();
    };
    overpass.handlers["onAjaxError"] = function(errmsg) {
      ide.waiter.close();
      var _originalDocumentTitle = document.title;
      document.title = "❗ " + _originalDocumentTitle;
      // show error dialog
      var dialog_buttons = [
        {
          name: i18n.t("dialog.dismiss"),
          callback: function() {
            document.title = _originalDocumentTitle;
          }
        }
      ];

      var content =
        '<p style="color:red;">' + i18n.t("error.ajax.expl") + "</p>" + errmsg;
      showDialog(i18n.t("error.ajax.title"), content, dialog_buttons);

      // print error text, if present
      if (overpass.resultText) ide.dataViewer.setValue(overpass.resultText);
    };
    overpass.handlers["onQueryError"] = function(errmsg) {
      ide.waiter.close();
      var _originalDocumentTitle = document.title;
      document.title = "❗ " + _originalDocumentTitle;
      var dialog_buttons = [
        {
          name: i18n.t("dialog.dismiss"),
          callback: function() {
            document.title = _originalDocumentTitle;
          }
        }
      ];
      var content =
        '<div class="notification is-danger is-light">' +
        i18n.t("error.query.expl") +
        "<br>" +
        errmsg +
        "</div>";
      showDialog(i18n.t("error.query.title"), content, dialog_buttons);
    };
    overpass.handlers["onStyleError"] = function(errmsg) {
      var dialog_buttons = [{name: i18n.t("dialog.dismiss")}];
      var content =
        '<p style="color:red;">' +
        i18n.t("error.mapcss.expl") +
        "</p>" +
        errmsg;
      showDialog(i18n.t("error.mapcss.title"), content, dialog_buttons);
    };
    overpass.handlers["onQueryErrorLine"] = function(linenumber) {
      ide.highlightError(linenumber);
    };
    overpass.handlers["onRawDataPresent"] = function() {
      ide.dataViewer.setOption("mode", overpass.resultType);
      ide.dataViewer.setValue(overpass.resultText);
    };
    overpass.handlers["onGeoJsonReady"] = function() {
      // show layer
      ide.map.addLayer(overpass.osmLayer);
      // autorun callback (e.g. zoom to data)
      if (typeof ide.run_query_on_startup === "function") {
        ide.run_query_on_startup();
      }
      // display stats
      if (settings.show_data_stats) {
        var stats = overpass.stats;
        var stats_txt =
          "<small>" +
          i18n.t("data_stats.loaded") +
          "</small>&nbsp;&ndash;&nbsp;" +
          "" +
          i18n.t("data_stats.nodes") +
          ":&nbsp;" +
          stats.data.nodes +
          ", " +
          i18n.t("data_stats.ways") +
          ":&nbsp;" +
          stats.data.ways +
          ", " +
          i18n.t("data_stats.relations") +
          ":&nbsp;" +
          stats.data.relations +
          (stats.data.areas > 0
            ? ", " + i18n.t("data_stats.areas") + ":&nbsp;" + stats.data.areas
            : "") +
          "<br/>" +
          "<small>" +
          i18n.t("data_stats.displayed") +
          "</small>&nbsp;&ndash;&nbsp;" +
          "" +
          i18n.t("data_stats.pois") +
          ":&nbsp;" +
          stats.geojson.pois +
          ", " +
          i18n.t("data_stats.lines") +
          ":&nbsp;" +
          stats.geojson.lines +
          ", " +
          i18n.t("data_stats.polygons") +
          ":&nbsp;" +
          stats.geojson.polys +
          "</small>";
        $(
          '<div id="data_stats" class="stats">' + stats_txt + "</div>"
        ).insertAfter("#map");
        // show more stats as a tooltip
        var backlogOverpass = function() {
          return moment(overpass.timestamp, moment.ISO_8601).fromNow(true);
          //return Math.round((new Date() - new Date(overpass.timestamp))/1000/60*10)/10;
        };
        var backlogOverpassAreas = function() {
          return moment(overpass.timestampAreas, moment.ISO_8601).fromNow(true);
        };
        var backlogOverpassExceedsLimit = function() {
          var now = moment();
          var ts = moment(overpass.timestamp, moment.ISO_8601);
          return now.diff(ts, "hours", true) >= 24;
        };
        var backlogOverpassAreasExceedsLimit = function() {
          var now = moment();
          var ts = moment(overpass.timestampAreas, moment.ISO_8601);
          return now.diff(ts, "hours", true) >= 96;
        };
        $("#data_stats").tooltip({
          items: "div",
          tooltipClass: "stats",
          content: function() {
            var str = "<div>";
            if (overpass.timestamp) {
              str +=
                i18n.t("data_stats.lag") +
                ": " +
                backlogOverpass() +
                " <small>" +
                i18n.t("data_stats.lag.expl") +
                "</small>";
            }
            if (overpass.timestampAreas) {
              str +=
                "<br>" +
                i18n.t("data_stats.lag_areas") +
                ": " +
                backlogOverpassAreas() +
                " <small>" +
                i18n.t("data_stats.lag.expl") +
                "</small>";
            }
            str += "</div>";
            return str;
          },
          hide: {
            effect: "fadeOut",
            duration: 100
          },
          position: {
            my: "right bottom-5",
            at: "right top"
          }
        });
        if (
          (overpass.timestamp && backlogOverpassExceedsLimit()) ||
          (overpass.timestampAreas && backlogOverpassAreasExceedsLimit())
        ) {
          $("#data_stats").css("background-color", "yellow");
        }
      }
    };
    overpass.handlers["onPopupReady"] = function(p) {
      p.openOn(ide.map);
    };

    // close startup waiter
    ide.waiter.close();

    // run the query immediately, if the appropriate flag was set.
    if (ide.run_query_on_startup === true) {
      ide.update_map();
      // automatically zoom to data.
      if (
        !args.has_coords &&
        args.has_query &&
        args.query.match(/\{\{(bbox|center)\}\}/) === null
      ) {
        ide.run_query_on_startup = function() {
          ide.run_query_on_startup = null;
          // hardcoded maxZoom of 18, should be ok for most real-world use-cases
          try {
            ide.map.fitBounds(overpass.osmLayer.getBaseLayer().getBounds(), {
              maxZoom: 18
            });
          } catch (e) {}
          // todo: zoom only to specific zoomlevel if args.has_zoom is given
        };
      }
    }
  } // init()

  this.onNominatimError = function(search, type) {
    // close waiter
    ide.waiter.close();
    // highlight error lines
    var query = ide.getRawQuery();
    query = query.split("\n");
    query.forEach(function(line, i) {
      if (line.indexOf("{{geocode" + type + ":" + search + "}}") !== -1)
        ide.highlightError(i + 1);
    });
    // show error message dialog
    var dialog_buttons = [{name: i18n.t("dialog.dismiss")}];
    var content =
      '<p style="color:red;">' +
      i18n.t("error.nominatim.expl") +
      "</p><p><i>" +
      htmlentities(search) +
      "</i></p>";
    showDialog(i18n.t("error.nominatim.title"), content, dialog_buttons);
  };
  /* this returns the current raw query in the editor.
   * shortcuts are not expanded. */
  this.getRawQuery = function() {
    return ide.codeEditor.getValue();
  };
  /* this returns the current query in the editor.
   * shortcuts are expanded. */
  this.getQuery = function(callback) {
    var query = ide.getRawQuery();
    var queryLang = ide.getQueryLang();
    // parse query and process shortcuts
    // special handling for global bbox in xml queries (which uses an OverpassQL-like notation instead of n/s/e/w parameters):
    query = query.replace(
      /(\<osm-script[^>]+bbox[^=]*=[^"'']*["'])({{bbox}})(["'])/,
      "$1{{__bbox__global_bbox_xml__ezs4K8__}}$3"
    );
    queryParser.parse(query, shortcuts(), function(query) {
      // parse mapcss declarations
      var mapcss = "";
      if (queryParser.hasStatement("style"))
        mapcss = queryParser.getStatement("style");
      ide.mapcss = mapcss;
      // parse data-source statements
      var data_source = null;
      if (queryParser.hasStatement("data")) {
        data_source = queryParser.getStatement("data");
        data_source = data_source.split(",");
        var data_mode = data_source[0].toLowerCase();
        data_source = data_source.slice(1);
        var options = {};
        for (var i = 0; i < data_source.length; i++) {
          var tmp = data_source[i].split("=");
          options[tmp[0]] = tmp[1];
        }
        data_source = {
          mode: data_mode,
          options: options
        };
      }
      ide.data_source = data_source;
      // call result callback
      callback(query);
    });
  };
  this.setQuery = function(query) {
    ide.codeEditor.setValue(query);
  };
  this.getQueryLang = function() {
    if ($.trim(ide.getRawQuery().replace(/{{.*?}}/g, "")).match(/^</))
      return "xml";
    else return "OverpassQL";
  };
  /* this is for repairig obvious mistakes in the query, such as missing recurse statements */
  this.repairQuery = function(repair) {
    // - preparations -
    var q = ide.getRawQuery(), // get original query
      lng = ide.getQueryLang();
    var autorepair = Autorepair(q, lng);
    // - repairs -
    if (repair == "no visible data") {
      // repair missing recurse statements
      autorepair.recurse();
    } else if (repair == "xml+metadata") {
      // repair output for OSM editors
      autorepair.editors();
    }
    // - set repaired query -
    ide.setQuery(autorepair.getQuery());
  };
  this.highlightError = function(line) {
    ide.codeEditor.setLineClass(line - 1, null, "errorline");
  };
  this.resetErrors = function() {
    for (var i = 0; i < ide.codeEditor.lineCount(); i++)
      ide.codeEditor.setLineClass(i, null, null);
  };

  this.switchTab = function(tab) {
    $(".tabs li." + tab).click();
  };

  this.loadExample = function(ex) {
    if (typeof settings.saves[ex] != "undefined")
      ide.setQuery(settings.saves[ex].overpass);
  };
  this.removeExample = function(ex, self) {
    var dialog_buttons = [
      {
        name: i18n.t("dialog.delete"),
        callback: function() {
          delete settings.saves[ex];
          settings.save();
          $(self)
            .parent("li")
            .remove();
        }
      },
      {name: i18n.t("dialog.cancel")}
    ];

    var content =
      "<p>" +
      '<span class="fas fa-exclamation-triangle" style="float:left; margin:1px 7px 20px 0;"></span>' +
      i18n.t("dialog.delete_query.expl") +
      ": &quot;<i>" +
      ex +
      "</i>&quot;?</p>";
    showDialog(i18n.t("dialog.delete_query.title"), content, dialog_buttons);
  };
  this.removeExampleSync = function(query, self) {
    var dialog_buttons = [
      {
        name: i18n.t("dialog.delete"),
        callback: function() {
          sync.delete(
            query.name,
            function(err) {
              if (err) return console.error(err);

              $(self)
                .parent()
                .remove();
            }.bind(this)
          );
        }
      },
      {
        name: i18n.t("dialog.cancel")
      }
    ];

    var content =
      '<p><span class="fas fa-exclamation-triangle" style="float:left; margin:1px 7px 20px 0;"></span>' +
      i18n.t("dialog.delete_query.expl-osm") +
      ": &quot;<i>" +
      query.name +
      "</i>&quot;?</p>";
    showDialog(i18n.t("dialog.delete_query.title"), content, dialog_buttons);
  };

  // Event handlers
  this.onLoadClick = function() {
    $("#load-dialog ul.saved_query, #load-dialog ul.example").html(""); // reset example lists
    // load example list
    var has_saved_query = false;
    for (var example in settings.saves) {
      var type = settings.saves[example].type;
      if (type == "template") continue;
      $("<li></li>")
        .append(
          $("<a>")
            .attr("href", "#")
            .text(example)
            .on(
              "click",
              (function(example) {
                return function() {
                  ide.loadExample(example);
                  $("#load-dialog").removeClass("is-active");
                  return false;
                };
              })(example)
            ),
          $("<a>")
            .attr("href", "#")
            .attr("title", i18n.t("load.delete_query") + ": " + example)
            .addClass("delete-query")
            .css("float", "right")
            .append(
              $('<span class="has-text-danger">')
                .addClass("fas")
                .addClass("fa-times")
            )
            .on(
              "click",
              (function(example) {
                return function() {
                  ide.removeExample(example, this);
                  return false;
                };
              })(example)
            ),
          $("<div>").css("clear", "right")
        )
        .appendTo("#load-dialog ul." + type);
      if (type == "saved_query") has_saved_query = true;
    }
    if (!has_saved_query)
      $("<li>" + i18n.t("load.no_saved_query") + "</li>").appendTo(
        "#load-dialog ul.saved_query"
      );
    $("#load-dialog").addClass("is-active");

    if (sync.authenticated()) {
      ide.loadOsmQueries();
    } else {
      var ui = $("#load-dialog .osm-queries");
      ui.show();
      var loadButton = $(
        "<button class='button is-link is-outlined t' title='load.title'>" +
          i18n.t("load.title") +
          "</button>"
      ).click(function() {
        ide.loadOsmQueries();
      });
      $("ul", ui)
        .html("")
        .append($("<li></li>").append(loadButton));
    }
  };
  this.loadOsmQueries = function() {
    var ui = $("#load-dialog .osm-queries");
    ui.show();
    $("ul", ui).html(
      "<li><i>" + i18n.t("load.saved_queries-osm-loading") + "</i></li>"
    );

    sync.load(function(err, queries) {
      if (err) {
        $("ul", ui).html(
          "<li><i>" + i18n.t("load.saved_queries-osm-error") + "</i></li>"
        );
        return console.error(err);
      }
      $("ul", ui).html("");
      $("#logout").show();
      queries.forEach(function(q) {
        $("<li></li>")
          .append(
            $("<a>")
              .attr("href", "#")
              .text(q.name)
              .on(
                "click",
                (function(query) {
                  return function() {
                    ide.setQuery(lzw_decode(Base64.decode(query.query)));
                    $("#load-dialog").removeClass("is-active");
                    return false;
                  };
                })(q)
              ),
            $("<a>")
              .attr("href", "#")
              .attr("title", i18n.t("load.delete_query") + ": " + q.name)
              .addClass("delete-query")
              .css("float", "right")
              .append(
                $('<span class="has-text-danger">')
                  .addClass("fas")
                  .addClass("fa-times")
              )
              .on(
                "click",
                (function(example) {
                  return function() {
                    ide.removeExampleSync(example, this);
                    return false;
                  };
                })(q)
              ),
            $("<div>").css("clear", "right")
          )
          .appendTo("#load-dialog ul.osm");
      });
    });
  };
  this.onLoadClose = function() {
    $("#load-dialog").removeClass("is-active");
  };
  this.onSaveClick = function() {
    // combobox for existing saves.
    var saves_names = new Array();
    for (var key in settings.saves)
      if (settings.saves[key].type != "template") saves_names.push(key);
    make_combobox($("#save-dialog input[name=save]"), saves_names);

    if (sync.enabled) {
      $("#save-dialog button.osm").show();
    }
    $("#save-dialog").addClass("is-active");
  };
  this.onSaveSumbit = function() {
    var name = $("#save-dialog input[name=save]")[0].value;
    settings.saves[htmlentities(name)] = {
      overpass: ide.getRawQuery(),
      type: "saved_query"
    };
    settings.save();
    $("#save-dialog").removeClass("is-active");
  };
  this.onSaveOsmSumbit = function() {
    var name = $("#save-dialog input[name=save]")[0].value;
    var query = ide.compose_share_link(ide.getRawQuery(), true).slice(3);
    sync.save(
      {
        name: name,
        query: query
      },
      function(err, new_queries) {
        if (err) return console.error(err);
        $("#logout").show();
        $("#save-dialog").removeClass("is-active");
      }
    );
  };
  this.onSaveClose = function() {
    $("#save-dialog").removeClass("is-active");
  };
  this.onLogoutClick = function() {
    sync.logout();
    $("#load-dialog ul.osm").html("");
    $("#logout").hide();
  };
  this.onRunClick = function() {
    ide.update_map();
  };
  this.onRerenderClick = function() {
    ide.rerender_map();
  };
  this.compose_share_link = function(query, compression, coords, run) {
    var share_link = "";
    if (!compression) {
      // compose uncompressed share link
      share_link += "?Q=" + encodeURIComponent(query);
      if (coords)
        share_link +=
          "&C=" +
          L.Util.formatNum(ide.map.getCenter().lat) +
          ";" +
          L.Util.formatNum(ide.map.getCenter().lng) +
          ";" +
          ide.map.getZoom();
      if (run) share_link += "&R";
    } else {
      // compose compressed share link
      share_link +=
        "?q=" + encodeURIComponent(Base64.encode(lzw_encode(query)));
      if (coords) {
        var encode_coords = function(lat, lng) {
          var coords_cpr = Base64.encodeNum(
            Math.round((lat + 90) * 100000) +
              Math.round((lng + 180) * 100000) * 180 * 100000
          );
          return "AAAAAAAA".substring(0, 9 - coords_cpr.length) + coords_cpr;
        };
        share_link +=
          "&c=" +
          encode_coords(ide.map.getCenter().lat, ide.map.getCenter().lng) +
          Base64.encodeNum(ide.map.getZoom());
      }
      if (run) share_link += "&R";
    }
    return share_link;
  };
  this.updateShareLink = function() {
    var baseurl = location.protocol + "//" + location.host + location.pathname;
    var query = ide.getRawQuery();
    var compress =
      (settings.share_compression == "auto" && query.length > 300) ||
      settings.share_compression == "on";
    var inc_coords = $("div#share-dialog input[name=include_coords]")[0]
      .checked;
    var run_immediately = $("div#share-dialog input[name=run_immediately]")[0]
      .checked;

    var shared_query = ide.compose_share_link(
      query,
      compress,
      inc_coords,
      run_immediately
    );
    var share_link = baseurl + shared_query;

    var warning = "";
    if (share_link.length >= 2000)
      warning = '<p class="warning">' + i18n.t("warning.share.long") + "</p>";
    if (share_link.length >= 4000)
      warning =
        '<p class="warning severe">' +
        i18n.t("warning.share.very_long") +
        "</p>";

    $("div#share-dialog #share_link_warning").html(warning);

    $("div#share-dialog #share_link_a")[0].href = share_link;
    $("div#share-dialog #share_link_textarea")[0].value = share_link;

    // automatically minify urls if enabled
    if (configs.short_url_service != "") {
      $.get(
        configs.short_url_service + encodeURIComponent(share_link),
        function(data) {
          $("div#share-dialog #share_link_a")[0].href = data;
          $("div#share-dialog #share_link_textarea")[0].value = data;
        }
      );
    }
  };
  this.onShareClick = function() {
    $("div#share-dialog input[name=include_coords]")[0].checked =
      settings.share_include_pos;
    ide.updateShareLink();
    $("#share-dialog").addClass("is-active");
  };
  this.onShareClose = function() {
    $("#share-dialog").removeClass("is-active");
  };
  this.onExportClick = function() {
    // prepare export dialog
    ide.getQuery(function(query) {
      var baseurl =
        location.protocol +
        "//" +
        location.host +
        location.pathname.match(/.*\//)[0];
      var server =
        ide.data_source &&
        ide.data_source.mode == "overpass" &&
        ide.data_source.options.server
          ? ide.data_source.options.server
          : settings.server;
      var queryWithMapCSS = query;
      if (queryParser.hasStatement("style"))
        queryWithMapCSS +=
          "{{style: " + queryParser.getStatement("style") + " }}";
      if (queryParser.hasStatement("data"))
        queryWithMapCSS += "{{data:" + queryParser.getStatement("data") + "}}";
      else if (settings.server !== configs.defaultServer)
        queryWithMapCSS += "{{data:overpass,server=" + settings.server + "}}";
      $("#export-dialog a#export-interactive-map")[0].href =
        baseurl + "map.html?Q=" + encodeURIComponent(queryWithMapCSS);
      // encoding exclamation marks for better command line usability (bash)
      $("#export-dialog a#export-overpass-api")[0].href =
        server +
        "interpreter?data=" +
        encodeURIComponent(query)
          .replace(/!/g, "%21")
          .replace(/\(/g, "%28")
          .replace(/\)/g, "%29");
      function toDataURL(text) {
        return (
          "data:text/plain;charset=" +
          (document.characterSet || document.charset) +
          ";base64," +
          Base64.encode(text, true)
        );
      }
      function copyHandler(text, successMessage) {
        return function() {
          // selector
          $("#export-clipboard-success").addClass("is-active");
          copyData = {
            "text/plain": text
          };
          document.execCommand("copy");
          $("#export-clipboard-success .message").html(
            i18n.t("export.copy_to_clipboard_success-message")
          );
          $("#export-clipboard-success .export-copy_to_clipboard-content").html(
            successMessage
          );
          return false;
        };
      }
      // export query
      $("#export-text .format").html(i18n.t("export.format_text"));
      $("#export-text .export").attr({
        download: "query.txt",
        target: "_blank",
        href: toDataURL(query)
      });
      $("#export-text .copy")
        .attr("href", "")
        .click(copyHandler(query));
      // export raw query
      var query_raw = ide.getRawQuery();
      $("#export-text_raw .format").html(i18n.t("export.format_text_raw"));
      $("#export-text_raw .export").attr({
        download: "query-raw.txt",
        target: "_blank",
        href: toDataURL(query_raw)
      });
      $("#export-text_raw .copy")
        .attr("href", "")
        .click(copyHandler(query_raw));
      // export wiki query
      var query_wiki =
        "{{OverpassTurboExample|loc=" +
        L.Util.formatNum(ide.map.getCenter().lat) +
        ";" +
        L.Util.formatNum(ide.map.getCenter().lng) +
        ";" +
        ide.map.getZoom() +
        "|query=\n";
      query_wiki += query_raw
        .replace(/{{/g, "mSAvmrw81O8NgWlX")
        .replace(/{/g, "Z9P563g6zQYzjiLE")
        .replace(/}}/g, "AtUhvGGxAlM1mP5i")
        .replace(/}/g, "Yfxw6RTW5lewTqtg")
        .replace(/mSAvmrw81O8NgWlX/g, "{{((}}")
        .replace(/Z9P563g6zQYzjiLE/g, "{{(}}")
        .replace(/AtUhvGGxAlM1mP5i/g, "{{))}}")
        .replace(/Yfxw6RTW5lewTqtg/g, "{{)}}")
        .replace(/\|/g, "{{!}}")
        .replace(/{{!}}{{!}}/g, "{{!!}}");
      query_wiki += "\n}}";
      $("#export-text_wiki .format").html(i18n.t("export.format_text_wiki"));
      $("#export-text_wiki .export").attr({
        download: "query-wiki.txt",
        target: "_blank",
        href: toDataURL(query_wiki)
      });
      $("#export-text_wiki .copy")
        .attr("href", "")
        .click(copyHandler(query_wiki));
      // export umap query
      var query_umap = query;
      // remove /* */ comments from query
      query_umap = query_umap.replace(/\/\*[\S\s]*?\*\//g, "");
      // replace //  comments from query
      query_umap = query_umap.replace(/\/\/.*/g, "");
      // removes indentation
      query_umap = query_umap.replace(/\n\s*/g, "");
      // replace bbox with south west north east
      query_umap = query_umap.replace(
        new RegExp(shortcuts().bbox, "g"),
        "{south},{west},{north},{east}"
      );
      $("#export-text_umap .format").html(i18n.t("export.format_text_umap"));
      $("#export-text_umap .export").attr({
        download: "query-umap.txt",
        target: "_blank",
        href: toDataURL(query_umap)
      });
      $("#export-text_umap .copy")
        .attr("href", "")
        .click(
          copyHandler(
            query_umap,
            i18n.t("export.section.query") +
              " (" +
              i18n.t("export.format_text_umap") +
              ")"
          )
        );
      var dialog_buttons = [{name: i18n.t("dialog.done")}];
      $("#export-dialog a#export-map-state")
        .unbind("click")
        .bind("click", function() {
          var content =
            "<h4>" +
            i18n.t("export.map_view.permalink") +
            "</h4>" +
            '<p><a href="//www.openstreetmap.org/#map=' +
            ide.map.getZoom() +
            "/" +
            L.Util.formatNum(ide.map.getCenter().lat) +
            "/" +
            L.Util.formatNum(ide.map.getCenter().lng) +
            '" target="_blank">' +
            i18n.t("export.map_view.permalink_osm") +
            "</a></p>" +
            "<h4>" +
            i18n.t("export.map_view.center") +
            "</h4><p>" +
            L.Util.formatNum(ide.map.getCenter().lat) +
            ", " +
            L.Util.formatNum(ide.map.getCenter().lng) +
            " <small>(" +
            i18n.t("export.map_view.center_expl") +
            ")</small></p>" +
            "<h4>" +
            i18n.t("export.map_view.bounds") +
            "</h4><p>" +
            L.Util.formatNum(ide.map.getBounds().getSouthWest().lat) +
            ", " +
            L.Util.formatNum(ide.map.getBounds().getSouthWest().lng) +
            ", " +
            L.Util.formatNum(ide.map.getBounds().getNorthEast().lat) +
            ", " +
            L.Util.formatNum(ide.map.getBounds().getNorthEast().lng) +
            "<br /><small>(" +
            i18n.t("export.map_view.bounds_expl") +
            ")</small></p>" +
            (ide.map.bboxfilter.isEnabled()
              ? "<h4>" +
                i18n.t("export.map_view.bounds_selection") +
                "</h4><p>" +
                L.Util.formatNum(
                  ide.map.bboxfilter.getBounds().getSouthWest().lat
                ) +
                ", " +
                L.Util.formatNum(
                  ide.map.bboxfilter.getBounds().getSouthWest().lng
                ) +
                ", " +
                L.Util.formatNum(
                  ide.map.bboxfilter.getBounds().getNorthEast().lat
                ) +
                ", " +
                L.Util.formatNum(
                  ide.map.bboxfilter.getBounds().getNorthEast().lng
                ) +
                "<br /><small>(" +
                i18n.t("export.map_view.bounds_expl") +
                ")</small></p>"
              : "") +
            "<h4>" +
            i18n.t("export.map_view.zoom") +
            "</h4><p>" +
            ide.map.getZoom() +
            "</p>";
          showDialog(i18n.t("export.map_view.title"), content, dialog_buttons);
          return false;
        });
      $("#export-dialog a#export-image")
        .unbind("click")
        .on("click", function() {
          ide.onExportImageClick();
          $("#export-dialog").removeClass("is-active");
          return false;
        });
      // GeoJSON format
      function constructGeojsonString(geojson) {
        var geoJSON_str;
        if (!geojson) geoJSON_str = i18n.t("export.geoJSON.no_data");
        else {
          console.log(new Date());
          var gJ = {
            type: "FeatureCollection",
            generator: configs.appname,
            copyright: overpass.copyright,
            timestamp: overpass.timestamp,
            features: geojson.features.map(function(feature) {
              return {
                type: "Feature",
                properties: feature.properties,
                geometry: feature.geometry
              };
            }) // makes deep copy
          };
          gJ.features.forEach(function(f) {
            var p = f.properties;
            f.id = p.type + "/" + p.id;
            f.properties = {
              "@id": f.id
            };
            // escapes tags beginning with an @ with another @
            for (var m in p.tags || {})
              f.properties[m.replace(/^@/, "@@")] = p.tags[m];
            for (var m in p.meta || {}) f.properties["@" + m] = p.meta[m];
            // expose internal properties:
            // * tainted: indicates that the feature's geometry is incomplete
            if (p.tainted) f.properties["@tainted"] = p.tainted;
            // * geometry: indicates that the feature's geometry is approximated via the Overpass geometry types "center" or "bounds"
            if (p.geometry) f.properties["@geometry"] = p.geometry;
            // expose relation membership (complex data type)
            if (p.relations && p.relations.length > 0)
              f.properties["@relations"] = p.relations;
            // todo: expose way membership for nodes?
          });
          geoJSON_str = JSON.stringify(gJ, undefined, 2);
        }
        return geoJSON_str;
      }
      $("#export-geoJSON .format").text("GeoJSON");
      $("#export-geoJSON .export")
        .attr("href", "")
        .unbind("click")
        .on("click", function() {
          var geoJSON_str = constructGeojsonString(overpass.geojson);
          var d = $("#export-download-dialog");

          // make content downloadable as file
          if (overpass.geojson) {
            var blob = new Blob([geoJSON_str], {
              type: "application/json;charset=utf-8"
            });
            saveAs(blob, "export.geojson");
          } else {
            d.addClass("is-active");
            $(".message", d).text(geoJSON_str);
          }
          return false;
        });
      $("#export-geoJSON .copy")
        .attr("href", "")
        .click(function() {
          var d = overpass.geojson
            ? $("#export-clipboard-success")
            : $("#export-download-dialog");
          d.addClass("is-active");
          if (overpass.geojson) {
            var geojson = constructGeojsonString(overpass.geojson);
            copyData = {
              "text/plain": geojson,
              "application/geo+json": geojson
            };
            document.execCommand("copy");
            $(".message", d).html(
              i18n.t("export.copy_to_clipboard_success-message")
            );
            $(".export-copy_to_clipboard-content", d).text("GeoJSON");
          } else {
            $(".message", d).text(i18n.t("export.geoJSON.no_data"));
          }
          return false;
        });
      $("#export-dialog a#export-geoJSON-gist")
        .unbind("click")
        .on("click", function() {
          var geoJSON_str = constructGeojsonString(overpass.geojson);
          $.ajax("https://api.github.com/gists", {
            method: "POST",
            data: JSON.stringify({
              description: "data exported by overpass turbo", // todo:descr
              public: true,
              files: {
                "overpass.geojson": {
                  // todo:name
                  content: geoJSON_str
                }
              }
            })
          })
            .done(function(data, textStatus, jqXHR) {
              var dialog_buttons = [{name: i18n.t("dialog.done")}];
              var content =
                "<p>" +
                i18n.t("export.geoJSON_gist.gist") +
                '&nbsp;<a href="' +
                data.html_url +
                '" target="_blank" class="external">' +
                data.id +
                "</a></p>" +
                "<p>" +
                i18n.t("export.geoJSON_gist.geojsonio") +
                '&nbsp;<a href="http://geojson.io/#id=gist:anonymous/' +
                data.id +
                '" target="_blank" class="external">' +
                i18n.t("export.geoJSON_gist.geojsonio_link") +
                "</a></p>";
              showDialog(
                i18n.t("export.geoJSON_gist.title"),
                content,
                dialog_buttons
              );
              // data.html_url;
            })
            .fail(function(jqXHR, textStatus, errorStr) {
              alert(
                "an error occured during the creation of the overpass gist:\n" +
                  JSON.stringify(jqXHR)
              );
            });
          return false;
        });
      // GPX format
      function constructGpxString(geojson) {
        var gpx_str;
        if (!geojson) gpx_str = i18n.t("export.GPX.no_data");
        else {
          gpx_str = togpx(geojson, {
            creator: configs.appname,
            metadata: {
              desc: "Filtered OSM data converted to GPX by overpass turbo",
              copyright: {"@author": overpass.copyright},
              time: overpass.timestamp
            },
            featureTitle: function(props) {
              if (props.tags) {
                if (props.tags.name) return props.tags.name;
                if (props.tags.ref) return props.tags.ref;
                if (props.tags["addr:housenumber"] && props.tags["addr:street"])
                  return (
                    props.tags["addr:street"] +
                    " " +
                    props.tags["addr:housenumber"]
                  );
              }
              return props.type + "/" + props.id;
            },
            //featureDescription: function(props) {},
            featureLink: function(props) {
              return "http://osm.org/browse/" + props.type + "/" + props.id;
            }
          });
          if (gpx_str[1] !== "?")
            gpx_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + gpx_str;
        }
        return gpx_str;
      }
      $("#export-GPX .format").text("GPX");
      $("#export-GPX .export")
        .attr("href", "")
        .unbind("click")
        .on("click", function() {
          var geojson = overpass.geojson;
          var gpx_str = constructGpxString(geojson);
          // make content downloadable as file
          if (geojson) {
            var blob = new Blob([gpx_str], {
              type: "application/xml;charset=utf-8"
            });
            saveAs(blob, "export.gpx");
          } else {
            var d = $("#export-download-dialog");
            d.addClass("is-active");
            $(".message", d).text(gpx_str);
          }
          return false;
        });
      $("#export-GPX .copy")
        .attr("href", "")
        .click(function() {
          var d = overpass.geojson
            ? $("#export-clipboard-success")
            : $("#export-download-dialog");
          d.addClass("is-active");
          if (overpass.geojson) {
            var gpx = constructGpxString(overpass.geojson);
            copyData = {
              "text/plain": gpx,
              "application/gpx+xml": gpx
            };
            document.execCommand("copy");
            $(".message", d).html(
              i18n.t("export.copy_to_clipboard_success-message")
            );
            $(".export-copy_to_clipboard-content", d).text("GPX");
          } else {
            $(".message", d).text(i18n.t("export.GPX.no_data"));
          }
          return false;
        });
      // KML format
      function constructKmlString(geojson) {
        geojson = geojson && JSON.parse(constructGeojsonString(geojson));
        if (!geojson) return i18n.t("export.KML.no_data");
        else {
          return tokml(geojson, {
            documentName: "overpass-turbo.eu export",
            documentDescription:
              "Filtered OSM data converted to KML by overpass turbo.\n" +
              "Copyright: " +
              overpass.copyright +
              "\n" +
              "Timestamp: " +
              overpass.timestamp,
            name: "name",
            description: "description"
          });
        }
      }
      $("#export-KML .format").text("KML");
      $("#export-KML .export")
        .attr("href", "")
        .unbind("click")
        .on("click", function() {
          var geojson = overpass.geojson;
          var kml_str = constructKmlString(geojson);
          // make content downloadable as file
          if (geojson) {
            var blob = new Blob([kml_str], {
              type: "application/xml;charset=utf-8"
            });
            saveAs(blob, "export.kml");
          } else {
            $("#export-download-dialog").addClass("is-active");
            $("#export-download-dialog .message").text(kml_str);
          }
          return false;
        });
      $("#export-KML .copy")
        .attr("href", "")
        .click(function() {
          var d = overpass.geojson
            ? $("#export-clipboard-success")
            : $("#export-download-dialog");
          d.addClass("is-active");
          if (overpass.geojson) {
            var kml = constructKmlString(overpass.geojson);
            copyData = {
              "text/plain": kml,
              "application/vnd.google-earth.kml+xml": kml
            };
            document.execCommand("copy");
            $(".message", d).html(
              i18n.t("export.copy_to_clipboard_success-message")
            );
            $(".export-copy_to_clipboard-content", d).text("KML");
          } else {
            $(".message", d).text(i18n.t("export.kml.no_data"));
          }
          return false;
        });
      // RAW format
      function constructRawData(geojson) {
        var raw_str, raw_type;
        var geojson = overpass.geojson;
        if (!geojson) raw_str = i18n.t("export.raw.no_data");
        else {
          var data = overpass.data;
          if (data instanceof XMLDocument) {
            raw_str = new XMLSerializer().serializeToString(data);
            raw_type = raw_str.match(/<osm/) ? "osm" : "xml";
          } else if (data instanceof Object) {
            raw_str = JSON.stringify(data, undefined, 2);
            raw_type = "json";
          } else {
            try {
              raw_str = data.toString();
            } catch (e) {
              raw_str = "Error while exporting the data";
            }
          }
        }
        return {
          raw_str: raw_str,
          raw_type: raw_type
        };
      }
      $("#export-raw .format").text(i18n.t("export.raw_data"));
      $("#export-raw .export")
        .attr("href", "")
        .unbind("click")
        .on("click", function() {
          var geojson = overpass.geojson;
          var raw = constructRawData(geojson);
          var raw_str = raw.raw_str;
          var raw_type = raw.raw_type;
          // make content downloadable as file
          if (geojson) {
            if (raw_type == "osm" || raw_type == "xml") {
              var blob = new Blob([raw_str], {
                type: "application/xml;charset=utf-8"
              });
              saveAs(blob, "export." + raw_type);
            } else if (raw_type == "json") {
              var blob = new Blob([raw_str], {
                type: "application/json;charset=utf-8"
              });
              saveAs(blob, "export.json");
            } else {
              var blob = new Blob([raw_str], {
                type: "application/octet-stream;charset=utf-8"
              });
              saveAs(blob, "export.dat");
            }
          } else {
            var d = $("#export-download-dialog");
            d.addClass("is-active");
            $(".message", d).text(raw_str);
          }
          return false;
        });
      $("#export-raw .copy")
        .attr("href", "")
        .click(function() {
          var d = overpass.geojson
            ? $("#export-clipboard-success")
            : $("#export-download-dialog");
          d.addClass("is-active");
          var geojson = overpass.geojson;
          if (geojson) {
            var raw = constructRawData(geojson);
            var raw_str = raw.raw_str;
            var raw_type = raw.raw_type;
            copyData = {
              "text/plain": raw_str
            };
            if (raw_type == "osm" || raw_type == "xml") {
              copyData["application/xml"] = raw_str;
            } else if (raw_type == "json") {
              copyData["application/json"] = raw_str;
            } else {
              copyData["application/octet-stream"] = raw_str;
            }
            document.execCommand("copy");
            $(".message", d).html(
              i18n.t("export.copy_to_clipboard_success-message")
            );
            $(".export-copy_to_clipboard-content", d).html(
              i18n.t("export.raw_data")
            );
          } else {
            $(".message", d).text(i18n.t("export.raw.no_data"));
          }
          return false;
        });

      $("#export-dialog a#export-convert-xml")[0].href =
        server + "convert?data=" + encodeURIComponent(query) + "&target=xml";
      $("#export-dialog a#export-convert-ql")[0].href =
        server + "convert?data=" + encodeURIComponent(query) + "&target=mapql";
      $("#export-dialog a#export-convert-compact")[0].href =
        server +
        "convert?data=" +
        encodeURIComponent(query) +
        "&target=compact";

      // OSM editors
      // first check for possible mistakes in query.
      var validEditorQuery = Autorepair.detect.editors(
        ide.getRawQuery(),
        ide.getQueryLang()
      );
      // * Level0
      var exportToLevel0 = $("#export-dialog a#export-editors-level0");
      exportToLevel0.unbind("click");
      function constructLevel0Link(query) {
        return (
          "http://level0.osmz.ru/?url=" +
          encodeURIComponent(
            server + "interpreter?data=" + encodeURIComponent(query)
          )
        );
      }
      if (validEditorQuery) {
        exportToLevel0[0].href = constructLevel0Link(query);
      } else {
        exportToLevel0[0].href = "";
        exportToLevel0.bind("click", function() {
          var dialog_buttons = [
            {
              name: i18n.t("dialog.repair_query"),
              callback: function() {
                ide.repairQuery("xml+metadata");
                ide.getQuery(function(query) {
                  exportToLevel0.unbind("click");
                  exportToLevel0[0].href = constructLevel0Link(query);
                });
              }
            },
            {
              name: i18n.t("dialog.continue_anyway"),
              callback: function() {
                exportToLevel0.unbind("click");
                exportToLevel0[0].href = constructLevel0Link(query);
              }
            }
          ];
          var content =
            "<p>" +
            i18n.t("warning.incomplete.remote.expl.1") +
            "</p><p>" +
            i18n.t("warning.incomplete.remote.expl.2") +
            "</p>";
          showDialog(
            i18n.t("warning.incomplete.title"),
            content,
            dialog_buttons
          );
          return false;
        });
      }
      // * JOSM
      $("#export-dialog a#export-editors-josm")
        .unbind("click")
        .on("click", function() {
          var export_dialog = $("#export-dialog");
          var send_to_josm = function(query) {
            var JRC_url = "http://127.0.0.1:8111/";
            $.getJSON(JRC_url + "version")
              .done(function(d, s, xhr) {
                if (d.protocolversion.major == 1) {
                  $.get(JRC_url + "import", {
                    // JOSM doesn't handle protocol-less links very well
                    url:
                      server.replace(/^\/\//, location.protocol + "//") +
                      "interpreter?data=" +
                      encodeURIComponent(query)
                  })
                    .fail(function(xhr, s, e) {
                      alert("Error: Unexpected JOSM remote control error.");
                    })
                    .done(function(d, s, xhr) {
                      console.log("successfully invoked JOSM remote constrol");
                    });
                } else {
                  var dialog_buttons = [{name: i18n.t("dialog.dismiss")}];
                  var content =
                    "<p>" +
                    i18n.t("error.remote.incompat") +
                    ": " +
                    d.protocolversion.major +
                    "." +
                    d.protocolversion.minor +
                    " :(</p>";
                  showDialog(
                    i18n.t("error.remote.title"),
                    content,
                    dialog_buttons
                  );
                }
              })
              .fail(function(xhr, s, e) {
                var dialog_buttons = [{name: i18n.t("dialog.dismiss")}];
                var content = "<p>" + i18n.t("error.remote.not_found") + "</p>";
                showDialog(
                  i18n.t("error.remote.title"),
                  content,
                  dialog_buttons
                );
              });
          };
          // first check for possible mistakes in query.
          var valid = Autorepair.detect.editors(
            ide.getRawQuery(),
            ide.getQueryLang()
          );
          if (valid) {
            // now send the query to JOSM via remote control
            send_to_josm(query);
            return false;
          } else {
            var dialog_buttons = [
              {
                name: i18n.t("dialog.repair_query"),
                callback: function() {
                  ide.repairQuery("xml+metadata");
                  ide.getQuery(function(query) {
                    send_to_josm(query);
                    export_dialog.removeClass("is-active");
                  });
                }
              },
              {
                name: i18n.t("dialog.continue_anyway"),
                callback: function() {
                  send_to_josm(query);
                  export_dialog.removeClass("is-active");
                }
              }
            ];
            var content =
              "<p>" +
              i18n.t("warning.incomplete.remote.expl.1") +
              "</p><p>" +
              i18n.t("warning.incomplete.remote.expl.2") +
              "</p>";
            showDialog(
              i18n.t("warning.incomplete.title"),
              content,
              dialog_buttons
            );
            return false;
          }
        });
      // open the export dialog
      $("#export-dialog").addClass("is-active");
    });
  };
  this.onExportDownloadClose = function() {
    $("#export-download-dialog").removeClass("is-active");
  };
  this.onExportClipboardClose = function() {
    $("#export-clipboard-success").removeClass("is-active");
  };
  this.onExportClose = function() {
    $("#export-dialog").removeClass("is-active");
  };
  this.onExportImageClick = function() {
    ide.waiter.open(i18n.t("waiter.export_as_image"));
    // 1. render canvas from map tiles
    // hide map controlls in this step :/
    // todo: also hide popups?
    ide.waiter.addInfo("prepare map");
    $("#map .leaflet-control-container .leaflet-top").hide();
    $("#data_stats").hide();
    if (settings.export_image_attribution) attribControl.addTo(ide.map);
    if (!settings.export_image_scale) scaleControl.removeFrom(ide.map);
    // try to use crossOrigin image loading. osm tiles should be served with the appropriate headers -> no need of bothering the proxy
    ide.waiter.addInfo("rendering map tiles");
    $("#map .leaflet-overlay-pane").hide();
    html2canvas(document.getElementById("map"), {
      useCORS: true,
      allowTaint: false,
      proxy: configs.html2canvas_use_proxy ? "/html2canvas_proxy/" : undefined, // use own proxy if necessary and available
      onrendered: function(canvas) {
        $("#map .leaflet-overlay-pane").show();
        if (settings.export_image_attribution)
          attribControl.removeFrom(ide.map);
        if (!settings.export_image_scale) scaleControl.addTo(ide.map);
        if (settings.show_data_stats) $("#data_stats").show();
        $("#map .leaflet-control-container .leaflet-top").show();
        ide.waiter.addInfo("rendering map data");
        // 2. render overlay data onto canvas
        canvas.id = "render_canvas";
        var ctx = canvas.getContext("2d");
        // get geometry for svg rendering
        var height = $("#map .leaflet-overlay-pane svg").height();
        var width = $("#map .leaflet-overlay-pane svg").width();
        var tmp = $("#map .leaflet-map-pane")[0].style.cssText.match(
          /.*?(-?\d+)px.*?(-?\d+)px.*/
        );
        var offx = +tmp[1];
        var offy = +tmp[2];
        if ($("#map .leaflet-overlay-pane").html().length > 0)
          ctx.drawSvg(
            $("#map .leaflet-overlay-pane").html(),
            offx,
            offy,
            width,
            height
          );
        ide.waiter.addInfo("converting to png image");
        // 3. export canvas as html image
        var imgstr = canvas.toDataURL("image/png");
        var attrib_message = "";
        if (!settings.export_image_attribution)
          attrib_message =
            '<p style="font-size:smaller; color:orange;">Make sure to include proper attributions when distributing this image!</p>';
        var dialog_buttons = [{name: i18n.t("dialog.done")}];

        ide.waiter.close();
        var content =
          '<p><img src="' +
          imgstr +
          '" alt="' +
          i18n.t("export.image.alt") +
          '" width="480px"/><br><!--<a href="' +
          imgstr +
          '" download="export.png" target="_blank">' +
          i18n.t("export.image.download") +
          "</a>--></p>" +
          attrib_message;
        showDialog(i18n.t("export.image.title"), content, dialog_buttons);
        canvas.toBlob(function(blob) {
          saveAs(blob, "export.png");
        });
      }
    });
  };
  this.onFfsClick = function() {
    $("#ffs-dialog #ffs-dialog-parse-error").hide();
    $("#ffs-dialog #ffs-dialog-typo").hide();
    $("#ffs-dialog .loading").hide();
    $("#ffs-dialog input[type=search]")
      .removeClass("is-danger")
      .unbind("keypress")
      .bind("keypress", function(e) {
        if (e.which == 13 || e.which == 10) {
          ide.onFfsRun(true);
          e.preventDefault();
        }
      });
    $("#ffs-dialog").addClass("is-active");
  };
  this.onFfsClose = function() {
    $("#ffs-dialog").removeClass("is-active");
  };
  this.onFfsBuild = function() {
    ide.onFfsRun(false);
  };
  this.onFfsRun = function(autorun) {
    // Show loading spinner and hide all errors
    $("#ffs-dialog input[type=search]").removeClass("is-danger");
    $("#ffs-dialog #ffs-dialog-parse-error").hide();
    $("#ffs-dialog #ffs-dialog-typo").hide();
    $("#ffs-dialog .loading").show();

    // Build query and run it immediately if autorun is set
    ide.update_ffs_query(
      undefined,
      function(err, ffs_result) {
        $("#ffs-dialog .loading").hide();
        if (!err) {
          $("#ffs-dialog").removeClass("is-active");
          if (autorun !== false) ide.onRunClick();
        } else {
          if (_.isArray(ffs_result)) {
            // show parse error message
            $("#ffs-dialog #ffs-dialog-parse-error").hide();
            $("#ffs-dialog #ffs-dialog-typo").show();
            $("#ffs-dialog input[type=search]").addClass("is-danger");
            var correction = ffs_result.join("");
            var correction_html = ffs_result
              .map(function(ffs_result_part, i) {
                if (i % 2 === 1) return "<b>" + ffs_result_part + "</b>";
                else return ffs_result_part;
              })
              .join("");
            $("#ffs-dialog #ffs-dialog-typo-correction").html(correction_html);
            $("#ffs-dialog #ffs-dialog-typo-correction")
              .unbind("click")
              .bind("click", function(e) {
                $("#ffs-dialog input[type=search]").val(correction);
                $(this)
                  .parent()
                  .hide();
                e.preventDefault();
              });
          } else {
            // show parse error message
            $("#ffs-dialog #ffs-dialog-typo").hide();
            $("#ffs-dialog #ffs-dialog-parse-error").show();
            $("#ffs-dialog input[type=search]").addClass("is-danger");
          }
        }
      }.bind(this)
    );
  };
  this.onSettingsClick = function() {
    $("#settings-dialog input[name=ui_language]")[0].value =
      settings.ui_language;
    var lngDescs = i18n.getSupportedLanguagesDescriptions();
    make_combobox(
      $("#settings-dialog input[name=ui_language]"),
      ["auto"].concat(i18n.getSupportedLanguages()).map(function(lng) {
        return {
          value: lng,
          label: lng == "auto" ? "auto" : lng + " - " + lngDescs[lng]
        };
      })
    );
    $("#settings-dialog input[name=server]")[0].value = settings.server;
    make_combobox(
      $("#settings-dialog input[name=server]"),
      configs.suggestedServers.concat(settings.customServers),
      settings.customServers,
      function deleteCallback(server) {
        settings.customServers.splice(
          settings.customServers.indexOf(server),
          1
        );
        settings.save();
      }
    );
    $("#settings-dialog input[name=no_autorepair]")[0].checked =
      settings.no_autorepair;
    // editor options
    $("#settings-dialog input[name=use_rich_editor]")[0].checked =
      settings.use_rich_editor;
    $("#settings-dialog input[name=editor_width]")[0].value =
      settings.editor_width;
    // sharing options
    $("#settings-dialog input[name=share_include_pos]")[0].checked =
      settings.share_include_pos;
    $("#settings-dialog input[name=share_compression]")[0].value =
      settings.share_compression;
    make_combobox($("#settings-dialog input[name=share_compression]"), [
      "auto",
      "on",
      "off"
    ]);
    // map settings
    $("#settings-dialog input[name=tile_server]")[0].value =
      settings.tile_server;
    make_combobox(
      $("#settings-dialog input[name=tile_server]"),
      configs.suggestedTiles.concat(settings.customTiles),
      settings.customTiles,
      function deleteCallback(tileServer) {
        settings.customTiles.splice(
          settings.customTiles.indexOf(tileServer),
          1
        );
        settings.save();
      }
    );
    $("#settings-dialog input[name=background_opacity]")[0].value =
      settings.background_opacity;
    $("#settings-dialog input[name=enable_crosshairs]")[0].checked =
      settings.enable_crosshairs;
    $("#settings-dialog input[name=disable_poiomatic]")[0].checked =
      settings.disable_poiomatic;
    $("#settings-dialog input[name=show_data_stats]")[0].checked =
      settings.show_data_stats;
    // export settings
    $("#settings-dialog input[name=export_image_scale]")[0].checked =
      settings.export_image_scale;
    $("#settings-dialog input[name=export_image_attribution]")[0].checked =
      settings.export_image_attribution;
    // open dialog
    $("#settings-dialog").addClass("is-active");
  };
  this.onSettingsSave = function() {
    // save settings
    var new_ui_language = $("#settings-dialog input[name=ui_language]")[0]
      .value;
    // reload ui if language has been changed
    if (settings.ui_language != new_ui_language) {
      i18n.translate(new_ui_language);
      moment.locale(new_ui_language);
      ffs.invalidateCache();
    }
    settings.ui_language = new_ui_language;
    settings.server = $("#settings-dialog input[name=server]")[0].value;
    if (
      configs.suggestedServers.indexOf(settings.server) === -1 &&
      settings.customServers.indexOf(settings.server) === -1
    ) {
      settings.customServers.push(settings.server);
    }
    settings.no_autorepair = $(
      "#settings-dialog input[name=no_autorepair]"
    )[0].checked;
    settings.use_rich_editor = $(
      "#settings-dialog input[name=use_rich_editor]"
    )[0].checked;
    var prev_editor_width = settings.editor_width;
    settings.editor_width = $(
      "#settings-dialog input[name=editor_width]"
    )[0].value;
    // update editor width (if changed)
    if (prev_editor_width != settings.editor_width) {
      $("#editor").css("width", settings.editor_width);
      $("#dataviewer").css("left", settings.editor_width);
    }
    settings.share_include_pos = $(
      "#settings-dialog input[name=share_include_pos]"
    )[0].checked;
    settings.share_compression = $(
      "#settings-dialog input[name=share_compression]"
    )[0].value;
    var prev_tile_server = settings.tile_server;
    settings.tile_server = $(
      "#settings-dialog input[name=tile_server]"
    )[0].value;
    if (
      configs.suggestedTiles.indexOf(settings.tile_server) === -1 &&
      settings.customTiles.indexOf(settings.tile_server) === -1
    ) {
      settings.customTiles.push(settings.tile_server);
    }
    // update tile layer (if changed)
    if (prev_tile_server != settings.tile_server)
      ide.map.tile_layer.setUrl(settings.tile_server);
    var prev_background_opacity = settings.background_opacity;
    settings.background_opacity = +$(
      "#settings-dialog input[name=background_opacity]"
    )[0].value;
    // update background opacity layer
    if (settings.background_opacity != prev_background_opacity)
      if (settings.background_opacity == 1)
        ide.map.removeLayer(ide.map.inv_opacity_layer);
      else
        ide.map.inv_opacity_layer
          .setOpacity(1 - settings.background_opacity)
          .addTo(ide.map);
    settings.enable_crosshairs = $(
      "#settings-dialog input[name=enable_crosshairs]"
    )[0].checked;
    settings.disable_poiomatic = $(
      "#settings-dialog input[name=disable_poiomatic]"
    )[0].checked;
    settings.show_data_stats = $(
      "#settings-dialog input[name=show_data_stats]"
    )[0].checked;
    $(".crosshairs").toggle(settings.enable_crosshairs); // show/hide crosshairs
    settings.export_image_scale = $(
      "#settings-dialog input[name=export_image_scale]"
    )[0].checked;
    settings.export_image_attribution = $(
      "#settings-dialog input[name=export_image_attribution]"
    )[0].checked;
    settings.save();
    $("#settings-dialog").removeClass("is-active");
  };
  this.onSettingsClose = function() {
    $("#settings-dialog").removeClass("is-active");
  };
  this.onHelpClick = function() {
    $("#help-dialog").addClass("is-active");
  };
  this.onHelpClose = function() {
    $("#help-dialog").removeClass("is-active");
  };
  this.onKeyPress = function(event) {
    if (
      (event.which == 120 && event.charCode == 0) || // F9
      ((event.which == 13 || event.which == 10) &&
        (event.ctrlKey || event.metaKey))
    ) {
      // Ctrl+Enter
      ide.onRunClick(); // run query
      event.preventDefault();
    }
    if (
      String.fromCharCode(event.which).toLowerCase() == "s" &&
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey
    ) {
      // Ctrl+S
      ide.onSaveClick();
      event.preventDefault();
    }
    if (
      String.fromCharCode(event.which).toLowerCase() == "o" &&
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey
    ) {
      // Ctrl+O
      ide.onLoadClick();
      event.preventDefault();
    }
    if (
      String.fromCharCode(event.which).toLowerCase() == "h" &&
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey
    ) {
      // Ctrl+H
      ide.onHelpClick();
      event.preventDefault();
    }
    if (
      (String.fromCharCode(event.which).toLowerCase() == "i" &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey) || // Ctrl+I
      (String.fromCharCode(event.which).toLowerCase() == "f" &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey)
    ) {
      // Ctrl+Shift+F
      ide.onFfsClick();
      event.preventDefault();
    }

    if (event.which === 27) {
      // Escape
      $(".modal").removeClass("is-active");
    }

    // todo: more shortcuts
  };
  this.update_map = function() {
    ide.waiter.open(i18n.t("waiter.processing_query"));
    ide.waiter.addInfo("resetting map");
    $("#data_stats").remove();
    // resets previously highlighted error lines
    this.resetErrors();
    // reset previously loaded data and overlay
    ide.dataViewer.setValue("");
    if (typeof overpass.osmLayer != "undefined")
      ide.map.removeLayer(overpass.osmLayer);
    $("#map_blank").remove();

    ide.waiter.addInfo("building query");
    // run the query via the overpass object
    ide.getQuery(function(query) {
      var query_lang = ide.getQueryLang();
      var server =
        ide.data_source &&
        ide.data_source.mode == "overpass" &&
        ide.data_source.options.server
          ? ide.data_source.options.server
          : settings.server;
      overpass.run_query(
        query,
        query_lang,
        undefined,
        undefined,
        server,
        ide.mapcss
      );
    });
  };
  this.rerender_map = function() {
    if (typeof overpass.osmLayer != "undefined")
      ide.map.removeLayer(overpass.osmLayer);
    ide.getQuery(function() {
      overpass.rerender(ide.mapcss);
    });
  };
  this.update_ffs_query = function(s, callback) {
    var search = s || $("#ffs-dialog input[type=search]").val();
    ffs.construct_query(
      search,
      undefined,
      function(err, query) {
        if (err) {
          ffs.repair_search(
            search,
            function(repaired) {
              if (repaired) {
                callback("repairable query", repaired);
              } else {
                if (s) return callback(true);
                // try to parse as generic ffs search
                this.update_ffs_query('"' + search + '"', callback);
              }
            }.bind(this)
          );
        } else {
          ide.setQuery(query);
          callback(null);
        }
      }.bind(this)
    );
  };
})(); // end create ide object

export default ide;
