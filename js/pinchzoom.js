/**
 * PinchZoom (iScrollZoom 기반) — anti-jump & no-bounce
 * - _zoomEnd 패치: 손 놓을 때 점프 제거(현재 위치 유지 + 경계만 클램프)
 * - 줌 중 bounce:false → 흰 영역/튕김 제거
 * - 1x 복귀 시 scrollTo(0,0) 제거 → 현재 위치 그대로 / 페이지 스크롤 즉시 가능
 * - 더블탭 확대/축소 포함
 * - (선택) 네이티브 브릿지 tellNative(true/false)
 *
 * 외부 의존: iscroll-zoom.js (5.x)
 */
$(function(){
    if (typeof IScrollZoom === 'undefined') {
      console.error('[PinchZoom] IScrollZoom not found. Include iscroll-zoom.js first.');
      return;
    }
  
    var UA = navigator.userAgent||'';
    var IS_ANDROID = /Android/i.test(UA);
  
    /* 네이티브 브릿지(옵션) */
    function tellNative(zooming){
      try { window.AndroidZoomBridge && AndroidZoomBridge.setZooming(zooming); } catch(e){}
    }햐
  
    /* ========== 공통 패치: _zoom (실시간 경계 재계산 + 하드클램프) ========== */
    (function patchZoom(){
        var U = IScrollZoom.utils || {};
        var _origZoomStart = IScrollZoom.prototype._zoomStart;
    
        IScrollZoom.prototype._zoomStart = function(e){
        if (_origZoomStart) _origZoomStart.call(this, e);
        this.__pzEMA = { dist:null, cx:null, cy:null, prevCx:null, prevCy:null };
        this.__pzStartAt = (U.getTime ? U.getTime() : Date.now());
        };
    
        // 경계를 즉시 재계산 (viewport=실화면, 오차여유)
        function recomputeBounds(ctx){
            // ① 뷰포트는 화면 높이/너비 기준으로 제한
            //    (컨테이너가 문서 흐름에서 커지면 iScroll이 스크롤 여유를 과소 계산하는 문제 방지)
            var vw = ctx.wrapper.clientWidth;
            var vh = Math.min(ctx.wrapper.clientHeight, (window.visualViewport ? window.visualViewport.height : window.innerHeight));
        
            ctx.wrapperWidth  = vw;
            ctx.wrapperHeight = vh;
        
            // ② 스케일 반영된 콘텐츠 크기(트랜스폼은 레이아웃에 안 잡히므로 offset * scale)
            var baseW = ctx.scroller.offsetWidth;
            var baseH = ctx.scroller.offsetHeight;
        
            // 가끔 이미지 디코딩 타이밍 등으로 0 또는 비정상 값이 나오는 경우 방지
            if (!baseW || !baseH) {
            var rect = ctx.scroller.getBoundingClientRect();
            baseW = baseW || Math.max(1, Math.round(rect.width  / (ctx.scale || 1)));
            baseH = baseH || Math.max(1, Math.round(rect.height / (ctx.scale || 1)));
            }
        
            ctx.scrollerWidth  = Math.round(baseW * ctx.scale);
            ctx.scrollerHeight = Math.round(baseH * ctx.scale);
        
            // ③ 경계(아주 약간의 여유를 줘서 끝픽셀까지 보이게)
            var EPS = 1; // 1px 여유
            ctx.maxScrollX = ctx.wrapperWidth  - ctx.scrollerWidth  + EPS;
            ctx.maxScrollY = ctx.wrapperHeight - ctx.scrollerHeight + EPS;
        
            ctx.hasHorizontalScroll = ctx.options.scrollX && ctx.maxScrollX < 0;
            ctx.hasVerticalScroll   = ctx.options.scrollY && ctx.maxScrollY < 0;
        }
  
    
        IScrollZoom.prototype._zoom = function(ev){
        var ET = IScrollZoom.utils && IScrollZoom.utils.eventType;
        if (!this.enabled || (ET && ET[ev.type] !== this.initiated)) return;
        if (this.options.preventDefault && ev.cancelable) ev.preventDefault();
        if (!ev.touches || !ev.touches[1]) return;
    
        var t0 = ev.touches[0], t1 = ev.touches[1];
        var dx = Math.abs(t0.pageX - t1.pageX);
        var dy = Math.abs(t0.pageY - t1.pageY);
        var dist = Math.sqrt(dx*dx + dy*dy);
        var cx   = (t0.pageX + t1.pageX)/2;
        var cy   = (t0.pageY + t1.pageY)/2;
    
        // 약간의 EMA로 흔들림 완화
        var em = this.__pzEMA;
        var aD = 0.28, aC = 0.30;
        if (em.dist == null) { em.dist = dist; em.cx = cx; em.cy = cy; }
        else {
            em.dist += aD*(dist - em.dist);
            em.cx   += aC*(cx   - em.cx);
            em.cy   += aC*(cy   - em.cy);
        }
    
        var now   = (U.getTime ? U.getTime() : Date.now());
        var boost = (now - this.__pzStartAt <= 120) ? ( /Android/i.test(navigator.userAgent) ? 1.10 : 1.05 ) : 1.0;
        var desired = this.startScale * Math.pow(em.dist / this.touchesDistanceStart, boost);
    
        // 하드 클램프(오버슈트 제거)
        var min = this.options.zoomMin, max = this.options.zoomMax;
        var n   = desired;
        if (n < min) n = min; else if (n > max) n = max;
    
        var hitMax = desired > max + 1e-6;
        var hitMin = desired < min - 1e-6;
    
        // 스케일 적용 전후 위치 보존 변환
        var k  = n / this.startScale;
        var nx = this.originX - this.originX*k + this.startX;
        var ny = this.originY - this.originY*k + this.startY;
    
        // ① 스케일 업데이트
        this.scale = n;
    
        // ② 새 스케일 기준으로 경계 즉시 재계산(핵심!!)
        recomputeBounds(this);
    
        // ③ 현재 이동 목표를 새 경계에 맞게 클램프
        if (nx > 0 || nx < this.maxScrollX) {
            nx = this.options.bounce ? (nx > 0 ? this.x + (nx - this.x)/3 : this.x + (nx - this.x)/3)
                                    : (nx > 0 ? 0 : this.maxScrollX);
        }
        if (ny > 0 || ny < this.maxScrollY) {
            ny = this.options.bounce ? (ny > 0 ? this.y + (ny - this.y)/3 : this.y + (ny - this.y)/3)
                                    : (ny > 0 ? 0 : this.maxScrollY);
        }
    
        // ④ 적용
        this.scrollTo(nx, ny, 0);
        this.scaled = true;
    
        // 최대/최소에 닿으면: 리베이스 + 2핀치 패닝
        if (hitMax || hitMin){
            if (em.prevCx != null){
            var dcx = em.cx - em.prevCx;
            var dcy = em.cy - em.prevCy;
            this.scrollBy(-dcx, -dcy, 0);
            }
            this.startScale = n;
            this.touchesDistanceStart = em.dist;
            this.startX = this.x; this.startY = this.y;
            this.originX = Math.abs(t0.pageX + t1.pageX)/2 + this.wrapperOffset.left - this.x;
            this.originY = Math.abs(t0.pageY + t1.pageY)/2 + this.wrapperOffset.top  - this.y;
        }
    
        em.prevCx = em.cx; em.prevCy = em.cy;
    
        if (this._updateNativeZoomingByScale) this._updateNativeZoomingByScale(this.scale);
        };
    })(); 
  
    /* ========== 핵심 패치: _zoomEnd 점프 제거 ========== */
    (function patchZoomEnd(){
      var ET = IScrollZoom.utils && IScrollZoom.utils.eventType;
      IScrollZoom.prototype._zoomEnd = function(e){
        if (!this.enabled || (ET && ET[e.type] !== this.initiated)) return;
        if (this.options.preventDefault && e.cancelable) e.preventDefault();
  
        this.isInTransition = 0;
        this.initiated = 0;
  
        // 배율 하드 클램프
        if (this.scale > this.options.zoomMax) this.scale = this.options.zoomMax;
        if (this.scale < this.options.zoomMin) this.scale = this.options.zoomMin;
  
        // ❗ iScroll 기본 로직은 startX/startY 기준으로 다시 계산 → 점프 유발
        // → 그냥 현재 x/y를 기준으로 경계만 클램프한다.
        this.refresh();
  
        var x = this.x, y = this.y;
        if (!this.hasHorizontalScroll || x > 0) x = 0;
        else if (x < this.maxScrollX) x = this.maxScrollX;
  
        if (!this.hasVerticalScroll || y > 0) y = 0;
        else if (y < this.maxScrollY) y = this.maxScrollY;
  
        if (x !== this.x || y !== this.y) {
          this.scrollTo(x, y, this.options.bounceTime);
        } else {
          this._execEvent('scrollEnd');
        }
        this.scaled = false;
        this._execEvent('zoomEnd');
      };
    })();
  
    /* ========== 유틸 ========== */
    function wrapIntoScroller(root){
      if (root.firstElementChild && root.firstElementChild.classList.contains('iscroll-scroller')) {
        return root.firstElementChild;
      }
      var sc = document.createElement('div');
      sc.className = 'iscroll-scroller';
      while (root.firstChild) sc.appendChild(root.firstChild);
      root.appendChild(sc);
      return sc;
    }
    function afterImages(el, cb){
      var imgs = el.querySelectorAll('img');
      if (!imgs.length) { cb(); return; }
      var left = imgs.length, done=false, t=setTimeout(finish, 1200);
      imgs.forEach(function(im){
        if (im.complete) { if(--left===0) finish(); }
        else{
          im.addEventListener('load', chk, {once:true});
          im.addEventListener('error', chk, {once:true});
          if (im.decode) im.decode().catch(function(){});
        }
        function chk(){ if(--left===0) finish(); }
      });
      function finish(){ if(done) return; done=true; clearTimeout(t); cb(); }
    }
  
    /* ========== 컨테이너 세팅 ========== */
    function setup(root){
      var scrollerEl = wrapIntoScroller(root);
  
      var z = new IScrollZoom(root, {
        zoom: true,
        zoomMin: 1,
        zoomMax: 4.0,           // ⬅ 더 키우려면 여기(예: 4.0/5.0)
        startZoom: 1,
  
        scrollX: true,
        scrollY: true,
        freeScroll: true,
  
        useTransition: false,
        useTransform: true,
        HWCompositing: true,
  
        disableMouse: true,
        disablePointer: true,
        disableTouch: false,
  
        bounce: true,                   // 페이지 모드 기본값
        bounceTime: IS_ANDROID ? 450 : 350,
        deceleration: IS_ANDROID ? 0.00095 : 0.0006,
        momentum: true,
  
        click: true,
        tap: true,
  
        preventDefault: true,
        preventDefaultException: { tagName: /^(INPUT|TEXTAREA|BUTTON|SELECT|A)$/i }
      });
  
      // 네이티브 알림(히스테리시스)
      var _zooming = false, TH_IN=1.02, TH_OUT=1.01;
      function setZooming(on){
        if (_zooming === on) return;
        _zooming = on; tellNative(on);
      }
      function updateNativeZoomingByScale(scale){
        var next = _zooming ? (scale > TH_OUT) : (scale > TH_IN);
        if (next !== _zooming) setZooming(next);
      }
      z._updateNativeZoomingByScale = updateNativeZoomingByScale;
  
      // 모드 전환: 줌 중엔 bounce 끔 / 1x 복귀 시 즉시 페이지 스크롤
      function enterZoomMode(){
        z.options.bounce = false;            // 흰여백/튕김 제거
        z.options.scrollX = true;
        z.options.scrollY = true;
        z.options.freeScroll = true;
        z.options.preventDefault = true;
  
        root.classList.add('is-zooming');
        root.style.touchAction = 'none';
  
        setZooming(true);
        z.refresh();
      }
      function enterPageMode(){
        z.options.bounce = true;
        z.options.scrollX = false;
        z.options.scrollY = false;
        z.options.freeScroll = false;
        z.options.preventDefault = false;
  
        root.classList.remove('is-zooming');
        root.style.touchAction = 'pan-y pinch-zoom';
  
        // ❗ 1x 복귀 시 강제 위치 이동 금지(점프 방지)
        if (z.scale !== 1) z.zoom(1, root.clientWidth/2, root.clientHeight/2, 0);
  
        setZooming(false);
        z.refresh();
      }
  
      // 초기: 1x (페이지 모드)
      enterPageMode();
  
      // 훅
      z.on('zoomStart', enterZoomMode);
      z.on('zoomEnd',   function(){ (z.scale <= TH_OUT) ? enterPageMode() : enterZoomMode(); });
      z.on('scrollEnd', function(){ if (z.scale <= TH_OUT) enterPageMode(); });
  
      // 더블탭
      (function bindDoubleTap(){
        var lastT=0,lastX=0,lastY=0, DUR=260, MOVE=16;
        root.addEventListener('touchend', function(ev){
          if (ev.touches && ev.touches.length) return;
          var t = ev.changedTouches ? ev.changedTouches[0] : ev;
          var now = performance.now();
          var isDT = (now - lastT) < DUR && Math.hypot(t.clientX-lastX, t.clientY-lastY) < MOVE;
          lastT = now; lastX = t.clientX; lastY = t.clientY;
          if (!isDT) return;
  
          ev.preventDefault();
          var to = (z.scale <= TH_OUT) ? Math.min(2.0, z.options.zoomMax) : 1;
          if (to > 1) enterZoomMode();
          z.zoom(to, t.pageX, t.pageY, IS_ANDROID ? 220 : 180);
          if (to === 1) setTimeout(enterPageMode, IS_ANDROID ? 240 : 200);
        }, {passive:false});
      })();
  
      // 이미지 로드 후 경계 재산출
      afterImages(scrollerEl, function(){
        // 컨테이너 폭과 이미지 원본비로 1x 높이 산출 → 스크롤러에 고정
        var img = scrollerEl.querySelector('img');
        if (img && img.naturalWidth && img.naturalHeight) {
          var w = root.clientWidth || scrollerEl.clientWidth || img.clientWidth || img.naturalWidth;
          var h1x = Math.round(img.naturalHeight * (w / img.naturalWidth));
          scrollerEl.style.height = h1x + 'px';   // 1배율 기준 콘텐츠 높이 고정
        }
        z.refresh();
      });
      
  
      root._iscrollZoom = z; // 디버그 핸들
    }
  
    function init(){ document.querySelectorAll('.zoom-container').forEach(setup); }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, {once:true});
    } else {
      init();
    }
  });
  