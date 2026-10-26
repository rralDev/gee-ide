# GEE IDE — R Map Shim
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

.resolve_smart_vis <- function(eeObject, visParams = list(), name = "Layer") {
    vis <- if (is.list(visParams)) visParams else list()
    is_vector <- inherits(eeObject, "ee.geometry.Geometry") ||
                 inherits(eeObject, "ee.feature.Feature") ||
                 inherits(eeObject, "ee.featurecollection.FeatureCollection")
    
    if (is_vector) {
        if (is.null(vis$color)) vis$color <- "FF0000"
        if (is.null(vis$width)) vis$width <- 2L
        return(list(vis = vis, is_vector = TRUE))
    }
    
    lname <- tolower(name)
    has_palette <- !is.null(vis$palette)
    has_color <- !is.null(vis$color)
    has_multi_bands <- !is.null(vis$bands) && length(vis$bands) > 1

    if (!has_palette && !has_color && !has_multi_bands) {
        if (grepl("elevation|dem|srtm|topo", lname)) {
            if (is.null(vis$min)) vis$min <- 0
            if (is.null(vis$max)) vis$max <- 3000
            vis$palette <- c("006600", "002200", "fff700", "ab7634", "c4d0ff", "ffffff")
        } else if (grepl("ndvi|evi|savi", lname)) {
            if (is.null(vis$min)) vis$min <- -0.2
            if (is.null(vis$max)) vis$max <- 0.85
            vis$palette <- c('#0c0c78', '#80b1d3', '#ffffff', '#ce7e45', '#df923d', '#fcd163', '#99b718', '#66a000', '#3e8601', '#056201', '#004c00')
        } else if (grepl("ndwi|water", lname)) {
            if (is.null(vis$min)) vis$min <- -0.5
            if (is.null(vis$max)) vis$max <- 0.5
            vis$palette <- c('#ffffff', '#ff0000', '#ffff00', '#00ffff', '#0000ff')
        } else if (inherits(eeObject, "ee.image.Image")) {
            tryCatch({
                bnames <- eeObject$bandNames()$getInfo()
                if (all(c("B4", "B3", "B2") %in% bnames)) {
                    vis$bands <- c("B4", "B3", "B2")
                    if (is.null(vis$min)) vis$min <- 0
                    if (is.null(vis$max)) vis$max <- 2800
                } else if (any(c("NDVI", "ndvi") %in% bnames)) {
                    if (is.null(vis$min)) vis$min <- -0.2
                    if (is.null(vis$max)) vis$max <- 0.85
                    vis$palette <- c('#0c0c78', '#80b1d3', '#ffffff', '#ce7e45', '#df923d', '#fcd163', '#99b718', '#66a000', '#3e8601', '#056201', '#004c00')
                }
            }, error = function(e) {})
        }
    }
    return(list(vis = vis, is_vector = FALSE))
}

.gee_pro_autoplot <- function(obj, name = "Auto-Plot") {
    if (is.null(obj)) return(invisible(NULL))
    is_ee <- inherits(obj, "ee.image.Image") || inherits(obj, "ee.imagecollection.ImageCollection") ||
             inherits(obj, "ee.geometry.Geometry") || inherits(obj, "ee.feature.Feature") ||
             inherits(obj, "ee.featurecollection.FeatureCollection") ||
             (is.environment(obj) && !is.null(obj$getMapId))
    if (is_ee) {
        cat(sprintf("🗺️ Auto-Plotting spatial object: %s...\n", name))
        tryCatch({ Map$centerObject(obj) }, error = function(e) {})
        tryCatch({ Map$addLayer(obj, name = name) }, error = function(e) {})
    }
}

plot <- function(x, ...) {
    is_ee <- inherits(x, "ee.computedobject.ComputedObject") ||
             inherits(x, "ee.geometry.Geometry") ||
             inherits(x, "ee.feature.Feature") ||
             inherits(x, "ee.featurecollection.FeatureCollection") ||
             inherits(x, "ee.image.Image") ||
             inherits(x, "ee.imagecollection.ImageCollection") ||
             (is.environment(x) && !is.null(x$getMapId))
    if (is_ee) {
        Map$centerObject(x)
        Map$addLayer(x, ...)
    } else {
        base::plot(x, ...)
    }
}

Map <- new.env(parent = emptyenv())

Map$setCenter <- function(lon, lat, zoom = 10) {
    cat(sprintf("[GEE IDE] Setting map center: lon=%.4f, lat=%.4f (zoom=%d)\n", lon, lat, as.integer(zoom)))
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
    cat(sprintf("[GEE IDE] Adding layer: %s...\n", name))
    tryCatch({
        resolved <- .resolve_smart_vis(eeObject, visParams, name)
        visParams <- resolved$vis
        is_vector <- resolved$is_vector
        
        target_obj <- eeObject
        # 1. Convert ImageCollection to mosaic
        if (inherits(target_obj, "ee.imagecollection.ImageCollection")) {
            target_obj <- target_obj$mosaic()
        }
        
        # 2. Convert Geometry / Feature / FeatureCollection to a styled Image layer
        if (is_vector) {
            color <- if (!is.null(visParams$color)) visParams$color else "FF0000"
            width <- if (!is.null(visParams$width)) as.integer(visParams$width) else 2L
            
            features <- ee$FeatureCollection(target_obj)
            tryCatch({
                outline <- features$style(color = color, fillColor = "00000000", width = width)
                target_obj <- features$style(fillColor = color)$updateMask(ee$Image$constant(0.4))$blend(outline)
            }, error = function(e) {
                target_obj <<- features$style(color = color, width = width)
            })
            map_id <- target_obj$getMapId(list())
        } else {
            map_id <- target_obj$getMapId(visParams)
        }
        
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
        
        vis_json <- if (length(visParams) > 0 && requireNamespace("jsonlite", quietly = TRUE)) {
            jsonlite::toJSON(visParams, auto_unbox = TRUE)
        } else {
            "{}"
        }
        
        payload <- sprintf('{"url":"%s","name":"%s","shown":%s,"opacity":%f,"visParams":%s,"isVector":%s}',
                           url, name, shown_str, opacity_num, vis_json, if (is_vector) "true" else "false")
        .gee_pro_send("addLayer", payload)
        cat(sprintf("[GEE IDE] Layer added: %s\n", name))
    }, error = function(e) {
        cat(sprintf("[Map Error] addLayer: %s\n", e$message))
    })
}

Map$clear <- function() {
    cat("[GEE IDE] Clearing map layers...\n")
    .gee_pro_send("clear", "{}")
}

Map$getBounds <- function(asGeoJson = FALSE) {
    if (exists("ee") && !is.null(ee$Geometry$Rectangle)) {
        return(ee$Geometry$Rectangle(c(-77.5, -12.5, -76.5, -11.5)))
    }
    return(c(-77.5, -12.5, -76.5, -11.5))
}

Map$getCenter <- function() {
    if (exists("ee") && !is.null(ee$Geometry$Point)) {
        return(ee$Geometry$Point(c(-77.0428, -12.0464)))
    }
    return(c(-77.0428, -12.0464))
}

Map$getZoom <- function() {
    return(10)
}

cli <- function(cmd) {
    payload <- sprintf('{"command":"%s"}', cmd)
    .gee_pro_send("cli", payload)
}

mkdir <- function(folder, parents = FALSE) {
    flag <- if (isTRUE(parents)) "-p " else ""
    cli(sprintf("mkdir %s%s", flag, folder))
}

rm_asset <- function(asset, recursive = FALSE) {
    flag <- if (isTRUE(recursive)) "-r " else ""
    cli(sprintf("rm %s%s", flag, asset))
}

ls_assets <- function(path = "") {
    cli(sprintf("ls %s", path))
}

touch <- function(collection) {
    cli(sprintf("touch %s", collection))
}

cd <- function(path = "") {
    cli(sprintf("cd %s", path))
}

pwd <- function() {
    cli("pwd")
}

find_assets <- function(pattern = "") {
    cli(sprintf("find %s", pattern))
}

du <- function(path = "") {
    cli(sprintf("du %s", path))
}
