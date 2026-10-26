"""More journeys: new draft with an image, request changes and resubmit, and a Brand Kit
edit that takes effect on the next review.

Start the app first:   MOCK_AI=1 PORT=4173 node scripts/dev-server.js
Then run:              python3 tests/e2e_more.py [base_url]
"""
import os
import sys
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173"
ROOT = os.path.join(os.path.dirname(__file__), "..")


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "net::ERR_" not in m.text else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        # 1. Brand Manager adds a banned term
        page.goto(BASE + "/#/kit/terms")
        page.get_by_role("button", name="Meera · Brand Manager").click()
        page.get_by_role("button", name="+ Add term").click()
        page.locator("#t-term").fill("super app")
        page.locator("[data-modal-submit]").click()
        expect(page.locator(".kit-table")).to_contain_text("super app")

        # 2. Creator makes a new draft with an image that uses the new term
        page.get_by_role("button", name="Priya · Creator").click()
        page.goto(BASE + "/#/")
        page.get_by_role("button", name="+ New draft").click()
        page.locator("#nd-title").fill("Launch teaser: LinkedIn")
        page.locator("#nd-body").fill("NimbuPay is the super app for every household. Payments confirm in about 2 seconds.")
        page.locator("#nd-image").set_input_files(os.path.join(ROOT, "assets", "security-card.png"))
        page.locator("[data-modal-submit]").click()
        expect(page.get_by_role("heading", name="Launch teaser: LinkedIn")).to_be_visible()
        page.locator(".workflow").get_by_role("button", name="Run review").click()
        expect(page.locator(".review-line")).to_contain_text("rules + AI", timeout=15000)
        assert page.locator(".finding", has_text='Banned phrase: "super app"').count() == 1, "new term was not applied"
        assert page.locator(".finding", has_text="Image has no alt text").count() == 1
        assert page.locator(".finding", has_text="Colours outside the brand palette").count() == 0, "on-brand image wrongly flagged"
        print("new draft findings:", page.locator(".finding").count())

        # 3. Fix and submit; reviewer requests changes; creator resubmits; reviewer approves
        for _ in range(10):
            btn = page.locator(".finding button[data-action='accept-fix']").first
            if btn.count() == 0:
                break
            btn.click()
        page.locator(".workflow").get_by_role("button", name="Submit for review").click()
        page.get_by_role("button", name="Arjun · Reviewer").click()
        page.locator(".workflow").get_by_role("button", name="Request changes").click()
        page.locator("#rc-note").fill("Please add our security message.")
        page.locator("[data-modal-submit]").click()
        expect(page.locator(".meta")).to_contain_text("Changes requested")
        page.get_by_role("button", name="Priya · Creator").click()
        expect(page.locator(".notice.warn").first).to_contain_text("Please add our security message")
        page.get_by_role("button", name="Edit text").first.click()
        page.locator("#body-editor").fill(page.locator("#body-editor").input_value() + " Every payment needs your UPI PIN.")
        page.get_by_role("button", name="Save as new version").click()
        submit = page.locator(".workflow").get_by_role("button", name="Submit for review")
        assert submit.is_disabled(), "submit should need a fresh review after editing"
        page.locator(".workflow").get_by_role("button", name="Run review").click()
        expect(page.locator(".review-line")).to_contain_text("rules + AI", timeout=15000)
        page.locator(".workflow").get_by_role("button", name="Submit for review").click()
        page.get_by_role("button", name="Arjun · Reviewer").click()
        page.locator(".workflow").get_by_role("button", name="Approve").click()
        page.locator("[data-modal-submit]").click()
        expect(page.locator(".meta")).to_contain_text("Approved")
        page.screenshot(path=os.path.join(ROOT, "test-output", "09-new-draft-approved.png"), full_page=True)

        # 4. Persistence: reload keeps the work
        page.reload()
        expect(page.locator(".meta")).to_contain_text("Approved")
        browser.close()
    if errors:
        print("console errors:", errors)
        sys.exit(1)
    print("E2E MORE OK")


if __name__ == "__main__":
    main()
