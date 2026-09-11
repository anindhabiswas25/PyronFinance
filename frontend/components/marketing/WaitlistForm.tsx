"use client";

import {type FormEvent, useRef, useState} from "react";

/**
 * The footer waitlist. Unlike the rest of the landing's behaviour this IS
 * genuine form state, so it becomes a controlled React component rather than a
 * DOM script — the address is echoed back into the confirmation copy as it is
 * typed, exactly as landing/main.js did.
 *
 * There is still no backend. POST to the real endpoint where the comment says.
 */
export function WaitlistForm({variant}: {variant?: "footer"}) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suffix = variant === "footer" ? " footer-s" : "";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailed(false);

    if (!inputRef.current?.checkValidity() || !email) {
      setFailed(true);
      inputRef.current?.focus();
      return;
    }

    // No backend yet — swap in the waitlist endpoint here.
    setDone(true);
  };

  return (
    <div className={`email-form-wrapper${done ? " is-done" : ""}`}>
      {!done && (
        <form className="email-form" noValidate onSubmit={onSubmit}>
          <input
            ref={inputRef}
            className="email-input"
            name="email"
            type="email"
            placeholder="Your email"
            maxLength={256}
            required
            aria-label="Your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input type="submit" className="email-submit" value="Join waitlist" />
        </form>
      )}

      {done && (
        <div className="success-message-wrapper" style={{display: "block"}}>
          <div className="success-message">
            <div className={variant === "footer" ? "success-text footer-s" : "body-b2"}>
              Thank you for your message. Someone will get in touch with you soon! We will
              contact you by mail <span className={`mail-span${suffix}`}>{email}</span>
            </div>
          </div>
        </div>
      )}

      {failed && (
        <div className="form-fail" style={{display: "block"}}>
          <div>Oops! Something went wrong while submitting the form.</div>
        </div>
      )}
    </div>
  );
}
