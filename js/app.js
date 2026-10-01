// ========================================
// ตั้งค่าสำคัญ
// ========================================
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxL7iRS966ejLaZYAs_dfQyNSrlBROAxD1hkyU1yHjI5a0_ePNjQELq0YCYwwg4xJuZ/exec";

// ขอบเขตจังหวัดนนทบุรี
const NONTHABURI = {
  center: [13.8621, 100.5144],
  zoom: 11,
  bounds: [
    [13.70, 100.25],   // มุมตะวันตกเฉียงใต้
    [14.10, 100.65]    // มุมตะวันออกเฉียงเหนือ
  ],
  polygon: [
    [13.72, 100.28],
    [13.75, 100.45],
    [13.82, 100.58],
    [13.95, 100.62],
    [14.05, 100.55],
    [14.08, 100.40],
    [14.02, 100.30],
    [13.90, 100.25],
    [13.80, 100.27],
    [13.72, 100.28]
  ]
};

// สีตามระดับน้ำท่วม
const LEVEL_COLORS = {
  "รุนแรง": "#dc3545",
  "ปานกลาง": "#fd7e14",
  "เล็กน้อย": "#198754"
};

// ========================================
let map;
let markersLayer;
let userMarker = null;
let reportModal;

// ========================================
document.addEventListener("DOMContentLoaded", () => {
  reportModal = new bootstrap.Modal(document.getElementById("reportModal"));
  
  initMap();
  loadReports();
  getDeviceLocation(true);

  document.getElementById("btnReport").addEventListener("click", openReportModal);
  document.getElementById("btnGetLocation").addEventListener("click", () => getDeviceLocation(false));
  document.getElementById("btnSubmitReport").addEventListener("click", submitReport);
  document.getElementById("btnRefresh").addEventListener("click", () => {
    loadReports();
    Swal.fire({
      toast: true,
      position: "top-end",
      icon: "success",
      title: "รีเฟรชข้อมูลแล้ว",
      showConfirmButton: false,
      timer: 1500
    });
  });
});

// ========================================
// เริ่มต้นแผนที่
// ========================================
function initMap() {
  map = L.map("map", {
    center: NONTHABURI.center,
    zoom: NONTHABURI.zoom,
    zoomControl: true,
    maxBounds: NONTHABURI.bounds,
    maxBoundsViscosity: 0.8,
    minZoom: 10
  });

  // แผนที่ฐาน
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri",
    maxZoom: 19
  }).addTo(map);

  // วาดเส้นประรอบจังหวัดนนทบุรี
  const provinceBoundary = L.polygon(NONTHABURI.polygon, {
    color: "#dc3545",
    weight: 3,
    opacity: 0.9,
    fillColor: "#dc3545",
    fillOpacity: 0.05,
    dashArray: "8, 8"
  }).addTo(map);

  provinceBoundary.bindPopup("<b>ขอบเขตจังหวัดนนทบุรี</b>");

  // ========== ชั้นน้ำท่วมจากดาวเทียม GISTDA ==========
  const GISTDA_API_KEY = "kvwsoyi3HWkLhLx0sjHnQLWbwzNfEsdiZhj1TZ684uj2drnhxEbai0X84kqM4byr";

  function createGistdaFloodLayer(days) {
    return L.tileLayer.wms(`https://api-gateway.gistda.or.th/api/2.0/resources/maps/flood/${days}/wms`, {
      layers: "flood",
      format: "image/png",
      transparent: true,
      version: "1.1.1",
      attribution: "© GISTDA - พื้นที่น้ำท่วมจากดาวเทียม",
      api_key: GISTDA_API_KEY
    });
  }

  const flood7days = createGistdaFloodLayer("7days");
  const flood3days = createGistdaFloodLayer("3days");
  const flood1day  = createGistdaFloodLayer("1day");

  // เปิดชั้น 7 วันเป็นค่าเริ่มต้น
  flood7days.addTo(map);

  // แสดง Legend ดาวเทียม
  const satelliteLegend = document.getElementById("satellite-legend");
  if (satelliteLegend) {
    satelliteLegend.style.display = "block";
  }

  // ปุ่มควบคุมชั้นข้อมูล
  const overlayMaps = {
    "น้ำท่วม 7 วัน (ดาวเทียม)": flood7days,
    "น้ำท่วม 3 วัน (ดาวเทียม)": flood3days,
    "น้ำท่วม 1 วัน (ดาวเทียม)": flood1day
  };

  L.control.layers(null, overlayMaps, {
    position: "topright",
    collapsed: false
  }).addTo(map);

  // จัดการแสดง/ซ่อน Legend
  map.on("overlayadd", function (e) {
    if (e.name && e.name.includes("ดาวเทียม") && satelliteLegend) {
      satelliteLegend.style.display = "block";
    }
  });

  map.on("overlayremove", function () {
    if (!satelliteLegend) return;
    const stillActive = map.hasLayer(flood7days) || map.hasLayer(flood3days) || map.hasLayer(flood1day);
    satelliteLegend.style.display = stillActive ? "block" : "none";
  });

  // Layer สำหรับ Marker จากประชาชน
  markersLayer = L.layerGroup().addTo(map);
}

// ========================================
// ดึงตำแหน่งจากมือถือ
// ========================================
function getDeviceLocation(isFirstLoad = false) {
  if (!navigator.geolocation) {
    showLocationError("เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง");
    return;
  }

  if (!isFirstLoad) {
    Swal.fire({
      title: "กำลังค้นหาตำแหน่ง...",
      text: "กรุณารอสักครู่",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      if (!isFirstLoad) Swal.close();

      const isInArea = isInsideNonthaburi(lat, lng);

      if (!isInArea) {
        Swal.fire({
          icon: "warning",
          title: "ตำแหน่งอยู่นอกจังหวัดนนทบุรี",
          html: `
            <p>ระบบตรวจพบว่าคุณอยู่นอกพื้นที่จังหวัดนนทบุรี</p>
            <p class="small text-muted">ละติจูด: ${lat.toFixed(5)}<br>ลองจิจูด: ${lng.toFixed(5)}</p>
          `,
          confirmButtonText: "ใช้ตำแหน่งนี้ต่อไป",
          showCancelButton: true,
          cancelButtonText: "ลองใหม่อีกครั้ง",
          confirmButtonColor: "#dc3545"
        }).then((result) => {
          if (result.isConfirmed) {
            updateUserLocation(lat, lng);
          } else {
            getDeviceLocation(false);
          }
        });
      } else {
        updateUserLocation(lat, lng);

        if (isFirstLoad && accuracy > 100) {
          Swal.fire({
            toast: true,
            position: "top",
            icon: "info",
            title: "ตำแหน่งอาจไม่แม่นยำ",
            text: `ความคลาดเคลื่อนประมาณ ${Math.round(accuracy)} เมตร`,
            showConfirmButton: false,
            timer: 3000
          });
        }
      }
    },
    (error) => {
      if (!isFirstLoad) Swal.close();

      let message = "ไม่สามารถระบุตำแหน่งได้";
      let advice = "";

      switch (error.code) {
        case error.PERMISSION_DENIED:
          message = "คุณปฏิเสธการเข้าถึงตำแหน่ง";
          advice = "กรุณาเปิดอนุญาต Location ในเบราว์เซอร์หรือตั้งค่ามือถือ แล้วกดปุ่มอัปเดทตำแหน่งอีกครั้ง";
          break;
        case error.POSITION_UNAVAILABLE:
          message = "ไม่สามารถหาตำแหน่งได้ในขณะนี้";
          advice = "กรุณาตรวจสอบว่าเปิด GPS / Location Services อยู่หรือไม่";
          break;
        case error.TIMEOUT:
          message = "หมดเวลาในการค้นหาตำแหน่ง";
          advice = "สัญญาณอ่อน กรุณาลองใหม่อีกครั้ง";
          break;
      }

      showLocationError(message, advice);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

// ========================================
// อัปเดทตำแหน่งผู้ใช้
// ========================================
function updateUserLocation(lat, lng) {
  document.getElementById("lat").value = lat;
  document.getElementById("lng").value = lng;
  document.getElementById("locationText").value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  map.setView([lat, lng], 14);

  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    const userIcon = L.divIcon({
      className: "",
      html: `<div class="user-marker"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    userMarker = L.marker([lat, lng], { 
      icon: userIcon, 
      zIndexOffset: 1000 
    })
    .addTo(map)
    .bindPopup("ตำแหน่งของคุณ");
  }
}

// ========================================
// ตรวจสอบอยู่ในจังหวัดนนทบุรีหรือไม่
// ========================================
function isInsideNonthaburi(lat, lng) {
  const b = NONTHABURI.bounds;
  return lat >= b[0][0] && lat <= b[1][0] && lng >= b[0][1] && lng <= b[1][1];
}

// ========================================
// แสดง Popup แจ้งเตือนตำแหน่ง
// ========================================
function showLocationError(title, advice = "") {
  Swal.fire({
    icon: "warning",
    title: title,
    html: advice ? `<p class="mb-3">${advice}</p>` : "",
    confirmButtonText: "ลองใหม่อีกครั้ง",
    confirmButtonColor: "#dc3545",
    showCancelButton: true,
    cancelButtonText: "ปิด",
    allowOutsideClick: false,
    width: "90%"
  }).then((result) => {
    if (result.isConfirmed) {
      getDeviceLocation(false);
    }
  });
}

// ========================================
// โหลดรายงานจาก Google Sheets
// ========================================
async function loadReports() {
  try {
    const response = await fetch(`${WEB_APP_URL}?action=getAll&status=เปิด`);
    const result = await response.json();

    markersLayer.clearLayers();

    if (result.success && result.data.length > 0) {
      result.data.forEach(report => createMarker(report));
    }
  } catch (error) {
    console.error("โหลดข้อมูลไม่สำเร็จ:", error);
  }
}

// ========================================
// สร้าง Marker ตามสี + ปุ่ม Street View
// ========================================
function createMarker(report) {
  const lat = parseFloat(report.lat);
  const lng = parseFloat(report.lng);
  const color = LEVEL_COLORS[report.level] || "#6c757d";

  const icon = L.divIcon({
    className: "",
    html: `<div class="custom-marker" style="background-color:${color};"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

  const popupContent = `
    <div style="min-width: 220px;">
      <div style="font-weight: bold; margin-bottom: 4px;">${report.tambon}</div>
      <span class="badge badge-level-${report.level}" style="margin-bottom: 6px; display: inline-block;">${report.level}</span>
      <div style="font-size: 0.85rem; margin-bottom: 6px;">${report.description || "ไม่มีรายละเอียดเพิ่มเติม"}</div>
      <div style="font-size: 0.8rem; color: #6c757d; margin-bottom: 10px;">
        <i class="bi bi-clock"></i> ${report.timestamp}<br>
        <i class="bi bi-person"></i> ${report.reporter_name || "ไม่ระบุ"}
      </div>
      ${report.image_url ? `<img src="${report.image_url}" style="width:100%; border-radius:6px; margin-bottom:10px; max-height:130px; object-fit:cover;">` : ""}
      
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <a href="${streetViewUrl}" target="_blank" rel="noopener" 
           style="display:block; text-align:center; padding:6px 10px; background:#0d6efd; color:white; border-radius:6px; text-decoration:none; font-size:0.85rem;">
          ดู Street View
        </a>
        <a href="${googleMapsUrl}" target="_blank" rel="noopener" 
           style="display:block; text-align:center; padding:6px 10px; background:#6c757d; color:white; border-radius:6px; text-decoration:none; font-size:0.85rem;">
          เปิดใน Google Maps
        </a>
      </div>
    </div>
  `;

  L.marker([lat, lng], { icon: icon })
    .addTo(markersLayer)
    .bindPopup(popupContent, {
      maxWidth: 260,
      minWidth: 220
    });
}

// ========================================
// เปิดฟอร์มรายงาน
// ========================================
function openReportModal() {
  document.getElementById("reportForm").reset();
  document.getElementById("locationText").value = "";
  document.getElementById("lat").value = "";
  document.getElementById("lng").value = "";
  
  getDeviceLocation(false);
  reportModal.show();
}

// ========================================
// ส่งรายงาน
// ========================================
async function submitReport() {
  const lat = document.getElementById("lat").value;
  const lng = document.getElementById("lng").value;
  const tambon = document.getElementById("tambon").value;
  const level = document.getElementById("level").value;
  const description = document.getElementById("description").value;
  const reporter_name = document.getElementById("reporter_name").value;
  const imageFile = document.getElementById("image").files[0];

  if (!lat || !lng || !tambon || !level) {
    Swal.fire({
      icon: "warning",
      title: "ข้อมูลไม่ครบ",
      text: "กรุณาระบุตำแหน่ง ตำบล และระดับน้ำท่วม"
    });
    return;
  }

  Swal.fire({
    title: "กำลังบันทึก...",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  let image_url = "";
  if (imageFile) {
    try {
      image_url = await toBase64(imageFile);
    } catch (e) {
      console.error(e);
    }
  }

  const payload = {
    action: "add",
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    tambon,
    level,
    description,
    reporter_name: reporter_name || "ไม่ระบุ",
    image_url
  };

  try {
    const response = await fetch(WEB_APP_URL, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (result.success) {
      Swal.fire({
        icon: "success",
        title: "บันทึกสำเร็จ",
        text: "ขอบคุณที่ช่วยรายงานสถานการณ์",
        timer: 1800,
        showConfirmButton: false
      });
      reportModal.hide();
      loadReports();
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    Swal.fire({
      icon: "error",
      title: "บันทึกไม่สำเร็จ",
      text: error.message || "เกิดข้อผิดพลาด"
    });
  }
}

// แปลงไฟล์รูปเป็น Base64
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
}