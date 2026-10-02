# GEE Pro IDE — R Map Shim
# Connects R / rgee to the VS Code Leaflet Map Viewer

options(prompt = " ", continue = " ")

.gee_pro_bridge_port <- Sys.getenv("GEE_PRO_BRIDGE_PORT", "31415")
.gee_pro_token <- Sys.getenv("GEE_PRO_ACCESS_TOKEN", "")
.gee_pro_project <- Sys.getenv("GEE_PRO_PROJECT", "")

# Auto-initialize Earth Engine via reticulate if credentials exist
if (nchar(.gee_pro_token) > 0 && requireNamespace("reticulate", quietly = TRUE)) {
    tryCatch({
        .py_ee <- reticulate::import("ee", delay_load = TRUE)
        .google_auth <- reticulate::import("google.oauth2.credentials", delay_load = TRUE)
        .creds <- .google_auth$Credentials(.gee_pro_token)
        if (nchar(.gee_pro_project) > 0) {
            .py_ee$Initialize(credentials = .creds, project = .gee_pro_project)
        } else {
            .py_ee$Initialize(credentials = .creds)
        }
        assign("ee", .py_ee, envir = .GlobalEnv)
    }, error = function(e) {})
}

.gee_pro_send <- function(action, payload_json) {
    body <- sprintf('{"action":"%s","payload":%s}', action, payload_json)
    url <- sprintf("http://127.0.0.1:%s", .gee_pro_bridge_port)
    system2("curl", c("-s", "-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@-", url), input = body, stdout = FALSE, stderr = FALSE)
}

Map <- new.env(parent = emptyenv())

Map$setCenter <- function(lon, lat, zoom = 10) {
    cat(sprintf("[GEE Pro] Setting map center: lon=%.4f, lat=%.4f (zoom=%d)\n", lon, lat, as.integer(zoom)))
    payload <- sprintf('{"lon":%f,"lat":%f,"zoom":%d}', lon, lat, as.integer(zoom))
    .gee_pro_send("setCenter", payload)
}

Map$centerObject <- function(eeObject, zoom = 12) {
    tryCatch({
        geom <- if (inherits(eeObject, "ee.geometry.Geometry")) {
            eeObject
        } else if (!is.null(eeObject$geometry) && is.function(eeObject$geometry)) {
            eeObject$geometry()
        } else {
            eeObject
        }
        
        bounds <- geom$bounds()$getInfo()
        coords <- bounds$coordinates[[1]]
        lons <- sapply(coords, function(c) c[[1]])
        lats <- sapply(coords, function(c) c[[2]])
        lon <- (min(lons) + max(lons)) / 2
        lat <- (min(lats) + max(lats)) / 2
        target_zoom <- if (!is.null(zoom)) as.integer(zoom) else 12
        Map$setCenter(lon, lat, target_zoom)
    }, error = function(e) {
        cat(sprintf("[Map Error] centerObject: %s\n", e$message))
    })
}

Map$addLayer <- function(eeObject, visParams = list(), name = "Layer", shown = TRUE, opacity = 1.0) {
    cat(sprintf("[GEE Pro] Adding layer: %s...\n", name))
    tryCatch({
        map_id <- eeObject$getMapId(visParams)
        url <- if (!is.null(map_id$tile_fetcher$url_format)) {
            map_id$tile_fetcher$url_format
        } else if (!is.null(map_id$urlFormat)) {
            map_id$urlFormat
        } else {
            as.character(map_id)
        }
        
        shown_str <- if (isTRUE(shown)) "true" else "false"
        opacity_num <- as.numeric(opacity)
        if (is.na(opacity_num)) opacity_num <- 1.0
        
        payload <- sprintf('{"url":"%s","name":"%s","shown":%s,"opacity":%f}', url, name, shown_str, opacity_num)
        .gee_pro_send("addLayer", payload)
        cat(sprintf("[GEE Pro] Layer added: %s\n", name))
    }, error = function(e) {
        cat(sprintf("[Map Error] addLayer: %s\n", e$message))
    })
}

Map$clear <- function() {
    cat("[GEE Pro] Clearing map layers...\n")
    .gee_pro_send("clear", "{}")
}
