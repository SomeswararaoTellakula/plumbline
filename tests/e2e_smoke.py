"""End-to-end smoke test of the main journey, in a real browser.

Start the app first:   MOCK_AI=1 PORT=4173 node scripts/dev-server.js
Then run:              python3 tests/e2e_smoke.py [base_url]

Journey: open the queue -> open the Diwali post -> run review -> accept fixes ->
override nothing -> submit -> switch to Reviewer -> approve. Fails on any console error.
"""
import os
import sys
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173"
OUT = os.path.join(os.path.dirname(__file__), "..", "test-output")
os.makedirs(OUT, exist_ok=True)


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "net::ERR_" not in m.text else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE + "/#/")
        expect(page.get_by_role("heading", name="Review queue")).to_be_visible()
        page.screenshot(path=f"{OUT}/01-queue.png", full_page=True)

        # Creator reviews the Diwali post
        page.get_by_role("button", name="Open the Diwali post").click()
        expect(page.get_by_role("heading", name="Diwali cashback: Instagram post")).to_be_visible()
        page.locator(".workflow").get_by_role("button", name="Run review").click()
        expect(page.locator(".review-line")).to_contain_text("rules + AI", timeout=15000)
        cards = page.locator(".finding")
        n = cards.count()
        print("findings after review:", n)
        assert n >= 10, n
        assert page.locator(".finding.f-blocker").count() >= 3
        assert page.locator(".ai-badge").count() >= 1
        page.screenshot(path=f"{OUT}/02-reviewed.png", full_page=True)

        # The validator rejected the invented "9 million" rewrite from the mock AI
        expect(page.locator(".rejected").first).to_contain_text("introduced a number")

        # Accept every fix that is offered
        for _ in range(30):
            btn = page.locator(".finding button[data-action='accept-fix']").first
            if btn.count() == 0:
                break
            btn.click()
        body = page.locator("#copy").inner_text()
        print("text after fixes:", body)
        assert "4.2 million" in body and "up to ₹100" in body and "T&C apply" in body and "PhonePe" not in body
        page.screenshot(path=f"{OUT}/03-fixed.png", full_page=True)

        # Remaining open blockers? (e.g. ranking claim with an AI fix accepted above)
        open_blockers = page.locator(".finding.f-blocker:not(.resolved)").count()
        print("open blockers:", open_blockers)

        # Dismiss non-blocking image artwork findings with a reason, as a creator would
        for _ in range(10):
            btn = page.locator(".finding:not(.resolved) button[data-action='dismiss']").first
            if btn.count() == 0:
                break
            btn.click()
            page.locator("#reason-note").fill("Design team will update the banner artwork today")
            page.locator("[data-modal-submit]").click()

        # Image blockers (₹200 in the artwork) need a Brand Manager override
        if page.locator(".finding.f-blocker:not(.resolved)").count():
            page.get_by_role("button", name="Meera · Brand Manager").click()
            for _ in range(10):
                btn = page.locator(".finding:not(.resolved) button[data-action='override']").first
                if btn.count() == 0:
                    break
                btn.click()
                page.locator("#reason-note").fill("Artwork being replaced; approved to proceed with corrected copy")
                page.locator("[data-modal-submit]").click()
            page.get_by_role("button", name="Priya · Creator").click()

        page.locator(".workflow").get_by_role("button", name="Submit for review").click()
        expect(page.locator(".meta")).to_contain_text("In review")

        # Reviewer approves
        page.get_by_role("button", name="Arjun · Reviewer").click()
        page.locator(".workflow").get_by_role("button", name="Approve").click()
        page.locator("[data-modal-submit]").click()
        expect(page.locator(".meta")).to_contain_text("Approved")
        page.screenshot(path=f"{OUT}/04-approved.png", full_page=True)

        # Version history and activity exist
        page.get_by_role("tab", name="Version history").click()
        assert page.locator(".versions li").count() >= 5
        page.goto(BASE + "/#/activity")
        expect(page.get_by_role("heading", name="Activity")).to_be_visible()
        assert page.locator("tbody tr").count() >= 8
        page.goto(BASE + "/#/kit/facts")
        expect(page.locator(".badge-exp").first).to_be_visible()
        page.screenshot(path=f"{OUT}/05-kit.png", full_page=True)

        browser.close()
    if errors:
        print("console errors:", errors)
        sys.exit(1)
    print("E2E OK")


if __name__ == "__main__":
    main()
