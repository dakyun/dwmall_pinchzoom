/**
 * PinchZoom for iScroll — OliveYoung style
 * - zoom: iScrollZoom 사용
 * - 확대 중/평시 모두: 세로 스와이프는 페이지로 전달 (eventPassthrough:'vertical')
 * - 이미지는 가로 패닝(필요한 대각 이동도 허용하되, 세로 내부 스크롤은 차단)
 * - 경계 하드 클램프 + 점프 제거
 */
(function($){
    $(function(){
      if (typeof IScrollZoom === 'undefined') {
        console.error('[PinchZoom] require iscroll-zoom.js');
        return;
      }
  
      /* ─ DOM 준비: .zoom-container > .iscroll-scroller > img ─ */
      function ensureScroller(root){
        if (root.firstElementChild && root.firstElementChild.classList.contains('iscroll-scroller')) {
          return root.firstElementChild;
        }
        var sc = document.createElement('div');
        sc.className = 'iscroll-scroller';
        while (root.firstChild) sc.appendChild(root.firstChild);
        root.appendChild(sc);
        return sc;
      }
  
      /* ─ 이미지 로드 대기 ─ */
      function afterImages(el, cb){
        var imgs = el.querySelectorAll('img');
        if (!imgs.length) return cb();
        var left = imgs.length, done=false, t=setTimeout(finish, 1500);
        imgs.forEach(function(im){
          if (im.complete) { if(--left===0) finish(); }
          else {
            im.addEventListener('load', check, {once:true});
            im.addEventListener('error', check, {once:true});
            if (im.decode) im.decode().catch(function(){});
          }
          function check(){ if(--left===0) finish(); }
        });
        function finish(){ if(done) return; done=true; clearTimeout(t); cb(); }
      }
  
      /* ─ 패치: 점프 제거 & 경계 하드 클램프 ─ */
      (function patch(){
        var ET = IScrollZoom.utils && IScrollZoom.utils.eventType;
  
        // zoomEnd 점프 제거
        IScrollZoom.prototype._zoomEnd = function(e){
          if (!this.enabled || (ET && ET[e.type] !== this.initiated)) return;
          if (this.options.preventDefault && e.cancelable) e.preventDefault();
  
          this.isInTransition = 0;
          this.initiated = 0;
  
          if (this.scale > this.options.zoomMax) this.scale = this.options.zoomMax;
          if (this.scale < this.options.zoomMin) this.scale = this.options.zoomMin;
  
          this.refresh();
  
          // 하드 클램프
          var x = this.x, y = this.y;
          if (!this.hasHorizontalScroll || x > 0) x = 0;
          else if (x < this.maxScrollX) x = this.maxScrollX;
  
          // 세로 내부 스크롤은 끔(scrollY=false) → 항상 0 기준
          y = 0;
  
          if (x !== this.x || y !== this.y) this.scrollTo(x, y, this.options.bounceTime);
          else this._execEvent('scrollEnd');
  
          this.scaled = false;
          this._execEvent('zoomEnd');
        };
  
        // refresh 재정의: 세로 내부 스크롤 끈 상태에서의 경계
        var _refresh = IScrollZoom.prototype.refresh;
        IScrollZoom.prototype.refresh = function(){
          _refresh.call(this);
  
          // 세로 내부 스크롤 비사용
          this.hasVerticalScroll = false;
          this.maxScrollY = 0;
          // 하드 클램프 한 번 더
          var nx = this.x;
          if (!this.hasHorizontalScroll || nx > 0) nx = 0;
          else if (nx < this.maxScrollX) nx = this.maxScrollX;
          if (nx !== this.x || this.y !== 0) this._translate(nx, 0);
        };
      })();
  
      /* ─ iScroll 초기화 ─ */
      function setup(root){
        var sc = ensureScroller(root);
  
        // 1x 기준 높이 강제 고정(서브픽셀 오차 예방)
        var img = sc.querySelector('img');
        afterImages(sc, function(){
          if (img && img.naturalWidth && img.naturalHeight){
            var w = root.clientWidth || sc.clientWidth || img.clientWidth || img.naturalWidth;
            var h = Math.ceil(img.naturalHeight * (w / img.naturalWidth));
            sc.style.height = h + 'px';
            img.style.height = h + 'px';
          }
        });
  
        var z = new IScrollZoom(root, {
          // ─ 기본 줌
          zoom: true,
          zoomMin: 1,
          zoomMax: 4,
          startZoom: 1,
  
          // ─ 스크롤 정책: 세로는 페이지로 패스, 가로만 내부 처리
          scrollX: true,
          scrollY: false,
          freeScroll: false,
          eventPassthrough: 'vertical', // ★ 핵심
  
          // ─ 물리/모션
          useTransition: false,
          useTransform: true,
          HWCompositing: true,
          momentum: true,
          bounce: false,
          bounceTime: 300,
          deceleration: 0.0006,
  
          // ─ 입력/이벤트
          disableMouse: true,
          disablePointer: true,
          disableTouch: false,
          click: true,
          tap: true,
  
          // ─ 기본적으로 preventDefault를 하지 않음 (페이지 스크롤 살리기)
          preventDefault: false,
          preventDefaultException: { tagName: /^(INPUT|TEXTAREA|BUTTON|SELECT|A)$/i }
        });
  
        // 줌 상태 시각화(선택)
        z.on('zoomStart', function(){
          root.classList.add('is-zooming');
        });
        z.on('zoomEnd', function(){
          root.classList.remove('is-zooming');
        });
  
        root._iscrollZoom = z;
      }
  
      function init(){ document.querySelectorAll('.zoom-container').forEach(setup); }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, {once:true});
      } else {
        init();
      }
    });
  })(jQuery);
  